// did:web of this Certo instance.
//
// Two shapes share one host (credenciales comunitarias, decision 0005):
//   did:web:<host>                 the platform; its document lists the keys of
//                                  ISSUER_DID_WEB_PROFILE_ID, or of every profile
//                                  without an organization DID when it is unset
//   did:web:<host>:org:<slug>      one organization; its document lists only the
//                                  keys of the profile whose didSlug is <slug>
// A profile without didSlug behaves exactly as before (single-issuer instances
// such as UDGPlus never set it). didSlug is never writable through the REST API.

/** Permanent, lowercase, never reused: it is part of every credential the organization signs. */
export const ORG_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** The host is configuration, never a request's Host/X-Forwarded-Host header. */
export function platformDid(strapi: any): string {
  const configured = process.env.ISSUER_DID_WEB_HOST
  const url = new URL(configured ? `https://${configured}` : (
    process.env.PUBLIC_URL || process.env.NUXT_PUBLIC_WEBSITE_URL || strapi.config.get('server.url')
  ))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (configured && (url.pathname !== '/' || url.search || url.hash))) {
    throw new Error('ISSUER_DID_WEB_HOST must contain only a host (and optional port)')
  }
  return `did:web:${url.host.replace(/:/g, '%3A')}`
}

/** @deprecated name kept for callers that only know the platform DID. */
export const issuerDid = platformDid

export function orgDid(strapi: any, slug: string): string {
  if (!ORG_SLUG.test(slug)) throw new Error('Invalid organization DID slug')
  return `${platformDid(strapi)}:org:${slug}`
}

async function profileSlug(strapi: any, profileId: number | string | undefined | null): Promise<string | null> {
  if (profileId === undefined || profileId === null) return null
  const profile = await strapi.db.query('api::profile.profile').findOne({ where: { id: profileId }, select: ['id', 'didSlug'] })
  const slug = profile?.didSlug
  if (slug === undefined || slug === null || slug === '') return null
  if (typeof slug !== 'string' || !ORG_SLUG.test(slug)) throw new Error('Invalid organization DID slug')
  return slug
}

/** Same as issuerDidFor, for a profile row already loaded with its didSlug. */
export function profileDid(strapi: any, profile: { didSlug?: string | null } | null | undefined): string {
  const slug = profile?.didSlug
  return slug ? orgDid(strapi, slug) : platformDid(strapi)
}

/** The DID a profile signs with: its organization DID, or the platform DID. */
export async function issuerDidFor(strapi: any, profileId: number | string | undefined | null): Promise<string> {
  const slug = await profileSlug(strapi, profileId)
  return slug ? orgDid(strapi, slug) : platformDid(strapi)
}

/** True for the platform DID and for any organization DID under it. */
export function isLocalDid(strapi: any, did: unknown): boolean {
  if (typeof did !== 'string') return false
  const base = did.split('#', 1)[0]
  const platform = platformDid(strapi)
  return base === platform || base.startsWith(`${platform}:org:`)
}

/**
 * A profile may sign when it has its own organization DID, or when it is the
 * platform's configured profile (or no platform profile is configured: legacy).
 */
export async function assertIssuerProfile(strapi: any, profileId: number | string) {
  if (await profileSlug(strapi, profileId)) return
  if (process.env.ISSUER_DID_WEB_PROFILE_ID && String(profileId) !== process.env.ISSUER_DID_WEB_PROFILE_ID) {
    throw new Error('Issuer profile is not authorized for this did:web')
  }
}

export async function publicMultikey(did: string, key: { id: number | string; publicKeyJwk: any }) {
  const jwk = key.publicKeyJwk
  if (jwk?.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string'
    || Buffer.from(jwk.x, 'base64url').length !== 32) throw new Error('Invalid Ed25519 public JWK')
  const { fromJwk } = await import('@digitalbazaar/ed25519-multikey')
  // Explicit allowlist: even a malformed row carrying "d" cannot leak it.
  const pair = await fromJwk({ jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    id: `${did}#key-${key.id}`, controller: did })
  return pair.export({ publicKey: true, includeContext: true })
}

/** Which key rows a local DID document publishes. Throws for an unknown organization. */
async function keyFilter(strapi: any, did: string): Promise<Record<string, any>> {
  const platform = platformDid(strapi)
  if (did === platform) {
    if (process.env.ISSUER_DID_WEB_PROFILE_ID) return { profile: process.env.ISSUER_DID_WEB_PROFILE_ID }
    // Without a platform profile the root DID keeps listing every profile,
    // except organizations, whose keys belong only to their own DID.
    return { profile: { didSlug: { $null: true } } }
  }
  const prefix = `${platform}:org:`
  if (!did.startsWith(prefix)) throw new Error('Not a DID of this instance')
  const slug = did.slice(prefix.length)
  if (!ORG_SLUG.test(slug)) throw new Error('Invalid organization DID slug')
  const profile = await strapi.db.query('api::profile.profile').findOne({ where: { didSlug: slug }, select: ['id'] })
  if (!profile) throw Object.assign(new Error('Unknown organization DID'), { status: 404 })
  return { profile: profile.id }
}

/** Read only: publishing a DID must never create a key or decrypt a secret. */
export async function issuerDidDocument(strapi: any, requested?: string) {
  const did = (requested || platformDid(strapi)).split('#', 1)[0]
  const keys = await strapi.db.query('api::issuer-key.issuer-key').findMany({
    where: { status: { $in: ['active', 'retired'] }, ...await keyFilter(strapi, did) },
    select: ['id', 'publicKeyJwk'], orderBy: { id: 'asc' },
  })
  const verificationMethod = await Promise.all(keys.map(key => publicMultikey(did, key)))
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did, verificationMethod,
    assertionMethod: verificationMethod.map(key => key.id),
    authentication: verificationMethod.map(key => key.id),
  }
}
