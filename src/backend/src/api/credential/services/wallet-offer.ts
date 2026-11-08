import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { signCredential, verifyCredentialStatus, verifyDataIntegrity, verificationLoader } from '../../../utils/data-integrity'
import { isLocalDid } from '../../../utils/issuer-did'
import { verifyWalletPresentation } from '../../../utils/wallet-presentation'
import { walletName, type WalletClient } from './holder-wallets'
import { webWalletLink } from './wallet-landing'

export const OFFER_UID = 'api::wallet-offer.wallet-offer'
export const COPY_UID = 'api::wallet-copy.wallet-copy'
export const exchangeHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const unavailable = () => Object.assign(new Error('Exchange unavailable'), { status: 404 })
/** A wallet the holder has not added yet: it waits for them to confirm it in the portal. */
export const awaitingApproval = () => Object.assign(new Error('Pending approval'), { status: 202 })

export function walletFormat(credential: any): boolean {
  const vc = credential?.signedCredential
  return vc?.['@context']?.[0] === 'https://www.w3.org/ns/credentials/v2'
    && vc.proof?.type === 'DataIntegrityProof' && vc.proof?.cryptosuite === 'eddsa-rdfc-2022'
    && !!vc.credentialSubject?.identifier?.some(i => i.type === 'IdentityObject' && i.hashed === true && /^sha256\$[a-f0-9]{64}$/.test(i.identityHash))
    && vc.credentialStatus?.type === 'BitstringStatusListEntry' && vc.credentialStatus?.statusPurpose === 'revocation'
}

export function offerLifetime() {
  const seconds = Number(process.env.WALLET_OFFER_TTL_SECONDS ?? 600)
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error('WALLET_OFFER_TTL_SECONDS must be 30..3600')
  return seconds * 1000
}

export default ({ strapi }) => ({
  async eligible(credential: any) {
    if (!walletFormat(credential)) return false
    const vc = credential.signedCredential
    if (credential.revoked || !isLocalDid(strapi, vc.issuer?.id || vc.issuer)
      || (vc.validUntil && Date.parse(vc.validUntil) <= Date.now())
      || (vc.validFrom && Date.parse(vc.validFrom) > Date.now())) return false
    return (await verifyDataIntegrity(vc, await verificationLoader(strapi, vc))).valid
      && (await verifyCredentialStatus(strapi, vc)).valid
  },

  async create(credential: any, { addWallet = false }: { addWallet?: boolean } = {}) {
    if (!await this.eligible(credential)) throw Object.assign(new Error('Credential cannot be saved to a wallet'), { status: 409 })
    const base = new URL(process.env.PUBLIC_URL || strapi.config.get('server.url'))
    if (base.username || base.password || !['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid public URL')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + offerLifetime()).toISOString()
    await strapi.db.query(OFFER_UID).create({ data: {
      tokenHash: exchangeHash(token), challenge: randomBytes(32).toString('base64url'),
      domain: base.host, expiresAt, status: 'pending', credential: credential.id,
      ownerId: credential.recipient.owner.id, addWallet: !!addWallet,
    } })
    const exchangeUrl = `${base.origin}/api/exchanges/${token}`
    const request = { protocols: { vcapi: exchangeUrl } }
    const encoded = encodeURIComponent(JSON.stringify(request))
    const walletUrl = `https://lcw.app/request.html?request=${encoded}`
    // The web wallet opens straight on its request page: the portal offers it
    // as «Abrir en la cartera» on a computer, no QR to decipher.
    let webWalletUrl: string | undefined
    try { if (process.env.WALLET_APP_URL) webWalletUrl = webWalletLink(process.env.WALLET_APP_URL, exchangeUrl) } catch { webWalletUrl = undefined }
    return { exchangeUrl, walletUrl, deepLink: `dccrequest://request?request=${encoded}`,
      interactionUrl: `${exchangeUrl}?iuv=1`, qrContent: walletUrl, webWalletUrl, expiresAt }
  },

  async pending(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw unavailable()
    const offer = await strapi.db.query(OFFER_UID).findOne({ where: { tokenHash: exchangeHash(token) }, populate: ['credential'] })
    if (!offer || offer.status !== 'pending') throw unavailable()
    if (Date.parse(offer.expiresAt) <= Date.now()) {
      await strapi.db.query(OFFER_UID).updateMany({ where: { id: offer.id, status: 'pending' }, data: { status: 'expired' } })
      throw unavailable()
    }
    if (!offer.credential) throw unavailable()
    return offer
  },

  async exchange(token: string, body: any, client: WalletClient = { client: 'app', clientOrigin: null }) {
    const offer = await this.pending(token)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw unavailable()
    if (Object.keys(body).length === 0) return { verifiablePresentationRequest: {
      query: [{ type: 'DIDAuthentication', acceptedCryptosuites: [{ cryptosuite: 'eddsa-rdfc-2022' }], acceptedMethods: [{ method: 'key' }, { method: 'web' }] }],
      challenge: offer.challenge, domain: offer.domain,
    } }
    if (Object.keys(body).length !== 1 || !body.verifiablePresentation) throw unavailable()
    const holderDid = await verifyWalletPresentation(body.verifiablePresentation, offer.challenge, offer.domain)
    // Only the holder's own wallets: the first one, or one added on purpose.
    const wallets = strapi.service('api::credential.holder-wallets')
    const admission = await wallets.admission(offer, holderDid)
    if (!admission.allowed) {
      // A new wallet does not get the credential yet: the offer remembers it
      // and the holder's portal asks «¿La agregas?» (decision of 7-oct-2026).
      // Only one new wallet per offer; a second one is refused outright.
      if (offer.pendingHolderDid && offer.pendingHolderDid !== holderDid) throw unavailable()
      if (!offer.pendingHolderDid) {
        await strapi.db.query(OFFER_UID).updateMany({ where: { id: offer.id, status: 'pending', pendingHolderDid: null }, data: {
          pendingHolderDid: holderDid, pendingClient: client.client, pendingOrigin: client.clientOrigin, requestedAt: new Date().toISOString(),
        } })
      }
      throw awaitingApproval()
    }
    const credential = await strapi.service('api::credential.holder-access').find(String(offer.credential.id))
    if (!credential || String(credential.recipient?.owner?.id) !== String(offer.ownerId) || !await this.eligible(credential)) throw unavailable()
    const copy = structuredClone(credential.signedCredential)
    copy.id = `urn:uuid:${randomUUID()}`
    copy.credentialSubject.id = holderDid
    const signedCredential = await signCredential(strapi, credential.issuer.id, copy)
    // Compare-and-set inside a DB transaction, not a process-local lock.
    // Both callers may verify/sign, but only one can consume or receive a copy.
    await strapi.db.transaction(async () => {
      const result = await strapi.db.query(OFFER_UID).updateMany({
        where: { id: offer.id, status: 'pending', expiresAt: { $gt: new Date().toISOString() } },
        data: { status: 'used', usedAt: new Date().toISOString() },
      })
      if (result.count !== 1) throw unavailable()
      const latest = await strapi.db.query('api::credential.credential').findOne({ where: { id: credential.id } })
      if (!latest || latest.revoked) throw unavailable()
      await strapi.db.query(COPY_UID).create({ data: {
        credential: credential.id, offer: offer.id, holderDid, credentialId: copy.id,
        signedCredential, boundAt: new Date().toISOString(),
      } })
      if (admission.isNew) await wallets.add(offer.ownerId, holderDid, client)
      else await wallets.identify(offer.ownerId, holderDid, client)
    })
    return { verifiablePresentation: {
      '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiablePresentation'],
      verifiableCredential: [signedCredential],
    } }
  },

  async summary(credential: any) {
    const rows = await strapi.db.query(COPY_UID).findMany({ where: { credential: credential.id }, orderBy: { boundAt: 'desc' },
      select: ['holderDid', 'boundAt', 'credentialId'] })
    return { eligible: await this.eligible(credential), legacy: !walletFormat(credential),
      // A revoked credential says so, with the issuer's reason, instead of the
      // generic "not available"; a corrected one names its replacement there.
      revoked: !!credential.revoked, revocationReason: credential.revoked ? credential.revocationReason || '' : '',
      walletCount: new Set(rows.map(row => row.holderDid)).size, copies: rows, revocation: 'shared',
      // A wallet the holder never added tried this credential's offer lately:
      // the portal explains how to add it instead of failing silently.
      rejectedWallet: await strapi.db.query(OFFER_UID).count({ where: { credential: credential.id, status: 'rejected',
        usedAt: { $gt: new Date(Date.now() - 15 * 60 * 1000).toISOString() } } }) > 0,
      pendingWallet: await this.awaiting(credential.id) }
  },

  /** The new wallet waiting for the holder's confirmation on this credential, if any. No DID. */
  async awaiting(credentialId: number) {
    const offer = await strapi.db.query(OFFER_UID).findOne({ where: { credential: credentialId, status: 'pending',
      pendingHolderDid: { $notNull: true }, approvedHolderDid: null, expiresAt: { $gt: new Date().toISOString() } }, orderBy: { requestedAt: 'desc' } })
    if (!offer) return null
    return { offerId: offer.id, client: offer.pendingClient || null, name: walletName(offer.pendingClient || null, offer.pendingOrigin || null), requestedAt: offer.requestedAt }
  },

  /**
   * Every new wallet waiting for this holder's confirmation, across all their
   * credentials: the portal shows it on any page, not only where the offer was
   * opened. No DIDs; the credential is named so the holder recognises it.
   */
  async awaitingForOwner(ownerId: number) {
    const offers = await strapi.db.query(OFFER_UID).findMany({ where: { ownerId, status: 'pending',
      pendingHolderDid: { $notNull: true }, approvedHolderDid: null, expiresAt: { $gt: new Date().toISOString() } },
    orderBy: { requestedAt: 'desc' }, limit: 5, populate: { credential: { select: ['credentialId', 'name'] } } })
    return offers.map(offer => ({ offerId: offer.id, credentialId: offer.credential?.credentialId || null,
      credentialName: offer.credential?.name || null, client: offer.pendingClient || null,
      name: walletName(offer.pendingClient || null, offer.pendingOrigin || null), requestedAt: offer.requestedAt, expiresAt: offer.expiresAt }))
  },

  /** The holder answers «¿La agregas?»: yes lets the waiting wallet redeem; no closes the offer. */
  async decide(ownerId: number, offerId: number, approve: boolean) {
    const offer = await strapi.db.query(OFFER_UID).findOne({ where: { id: offerId, ownerId, status: 'pending', approvedHolderDid: null } })
    if (!offer || !offer.pendingHolderDid || Date.parse(offer.expiresAt) <= Date.now()) return false
    await strapi.db.query(OFFER_UID).updateMany({ where: { id: offer.id, status: 'pending' }, data: approve
      ? { approvedHolderDid: offer.pendingHolderDid }
      : { status: 'rejected', usedAt: new Date().toISOString() } })
    return true
  },
})
