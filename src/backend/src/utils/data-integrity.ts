import { webcrypto } from 'node:crypto'
import ob3Context from './contexts/ob3-v3.0.3.json'
import { assertIssuerProfile, isLocalDid, issuerDidDocument, issuerDidFor, publicMultikey } from './issuer-did'
import { resolveDidWeb } from './did-web'

export const OB3_CONTEXTS = ['https://www.w3.org/ns/credentials/v2',
  'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json']

/** Offline allowlist. No default JSON-LD HTTP loader, even during verification. */
export async function localDocumentLoader(documents: Map<string, any> = new Map()) {
  const modules = await Promise.all([
    import('@digitalbazaar/credentials-context'), import('@digitalbazaar/data-integrity-context'),
    import('@digitalbazaar/multikey-context'), import('did-context'),
  ])
  const contexts = new Map<string, any>([[OB3_CONTEXTS[1], ob3Context]])
  for (const module of modules) for (const [url, value] of module.contexts) contexts.set(url, value)
  return async (url: string) => {
    const document = contexts.get(url) || documents.get(url)
    if (!document) throw new Error(`Document not available in local loader: ${url}`)
    return { contextUrl: null, documentUrl: url, document: structuredClone(document) }
  }
}

export function didDocuments(document: any): Map<string, any> {
  const documents = new Map<string, any>([[document.id, document]])
  for (const key of document.verificationMethod || []) {
    documents.set(key.id, { '@context': document['@context'], ...key })
  }
  return documents
}

export async function dataIntegritySuite(signer?: any) {
  const { DataIntegrityProof } = await import('@digitalbazaar/data-integrity')
  const { cryptosuite } = await import('@digitalbazaar/eddsa-rdfc-2022-cryptosuite')
  return new DataIntegrityProof({ cryptosuite, ...(signer ? { signer } : {}) })
}

export async function signCredential(strapi: any, profileId: number | string, document: any) {
  await assertIssuerProfile(strapi, profileId)
  const did = await issuerDidFor(strapi, profileId)
  if ((document.issuer?.id || document.issuer) !== did) throw new Error('Signing issuer must be the did:web of the signing profile')
  const { privateKey, publicKeyJwk, keyId } = await strapi.service('api::profile.issuer-keys').getOrCreateKeyPair(profileId)
  const key = await publicMultikey(did, { id: keyId, publicKeyJwk })
  // WebCrypto signs using the existing non-extractable PKCS8 CryptoKey.
  // The encrypted storage and provider boundary remain unchanged; no private
  // JWK/multibase copy is needed (nor returned to the caller).
  const signer = { id: key.id, algorithm: 'Ed25519',
    sign: async ({ data }) => new Uint8Array(await webcrypto.subtle.sign('Ed25519', privateKey, data)) }
  const { default: jsigs } = await import('jsonld-signatures')
  const { proof: _proof, ...unsigned } = document
  return jsigs.sign(JSON.parse(JSON.stringify(unsigned)), {
    suite: await dataIntegritySuite(signer), purpose: new jsigs.purposes.AssertionProofPurpose(),
    documentLoader: await localDocumentLoader(),
  })
}

export async function verifyDataIntegrity(document: any, documentLoader: any) {
  const { default: jsigs } = await import('jsonld-signatures')
  const proof = Array.isArray(document.proof) ? document.proof[0] : document.proof
  if (proof?.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-rdfc-2022'
    || proof.proofPurpose !== 'assertionMethod') return { valid: false, message: 'Unsupported Data Integrity proof' }
  const issuer = document.issuer?.id || document.issuer
  const { document: controller } = await documentLoader(issuer)
  if (controller.id !== issuer || !controller.assertionMethod?.some(method => (method.id || method) === proof.verificationMethod)) {
    return { valid: false, message: 'Verification method is not authorized by the issuer' }
  }
  const result = await jsigs.verify(document, { suite: await dataIntegritySuite(),
    purpose: new jsigs.purposes.AssertionProofPurpose({ controller }), documentLoader })
  return result.verified ? { valid: true } : { valid: false, message: result.error?.message || 'Invalid Data Integrity signature' }
}

/** Resolve only the claimed issuer; arbitrary contexts never trigger HTTP. */
export async function verificationLoader(strapi: any, document: any) {
  const did = document.issuer?.id || document.issuer
  const controller = isLocalDid(strapi, did) ? await issuerDidDocument(strapi, did) : await resolveDidWeb(did)
  if (controller.id !== did) throw new Error('Resolved DID does not match issuer')
  return localDocumentLoader(didDocuments(controller))
}

export async function verifyCredentialStatus(strapi: any, document: any) {
  if (!document.credentialStatus) return { valid: true }
  const entries = Array.isArray(document.credentialStatus) ? document.credentialStatus : [document.credentialStatus]
  if (entries.some(entry => entry.type !== 'BitstringStatusListEntry' || entry.statusPurpose !== 'revocation')) {
    return { valid: false, message: 'Unsupported credential status' }
  }
  const loader = await verificationLoader(strapi, document)
  const lists = new Map<string, any>()
  for (const entry of entries) {
    if (!/^(0|[1-9]\d*)$/.test(entry.statusListIndex)) throw new Error('Invalid status list index')
    const url = new URL(entry.statusListCredential)
    const base = new URL(strapi.config.get('server.url'))
    const match = url.pathname.match(/^\/api\/revocation-lists\/(\d+)$/)
    let list
    if (url.origin === base.origin && match) {
      const row = await strapi.entityService.findOne('api::revocation-list.revocation-list', match[1], { populate: ['issuer'] })
      if (!row) throw new Error('Status list not found')
      list = await strapi.service('api::revocation-list.revocation-list').serializeCredential(row)
    } else {
      // Status lists are published by the claimed issuer, never arbitrary
      // cross-origin URLs supplied inside an untrusted upload.
      const did = document.issuer?.id || document.issuer
      const { didWebDocumentUrl } = await import('./did-web')
      if (url.origin !== new URL(didWebDocumentUrl(did)).origin || url.username || url.password) {
        throw new Error('Status list must be hosted by the issuer')
      }
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/vc+ld+json, application/ld+json, application/json' } })
      if (!response.ok) throw new Error(`Status list returned HTTP ${response.status}`)
      list = await response.json()
    }
    if (list.id !== entry.statusListCredential) throw new Error('Status list identifier mismatch')
    lists.set(entry.statusListCredential, list)
  }
  const { checkStatus } = await import('@digitalbazaar/vc-bitstring-status-list')
  const result = await checkStatus({ credential: document, suite: await dataIntegritySuite(),
    verifyMatchingIssuers: true, verifyBitstringStatusListCredential: true,
    documentLoader: async url => lists.has(url)
      ? { document: lists.get(url), documentUrl: url, contextUrl: null } : loader(url) })
  return result.verified ? { valid: true } : { valid: false, message: result.error?.message || 'Credential is revoked' }
}
