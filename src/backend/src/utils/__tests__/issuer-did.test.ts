import { assertIssuerProfile, isLocalDid, issuerDidDocument, issuerDidFor, orgDid } from '../issuer-did'
import { didWebDocumentUrl } from '../did-web'

// Fake db: profiles by id and slug, keys by profile.
function fakeStrapi(profiles: any[], keys: any[] = []) {
  const findMany = jest.fn(async ({ where }) => keys.filter(key => {
    if (typeof where.profile === 'object' && where.profile?.didSlug) {
      const profile = profiles.find(p => p.id === key.profile)
      return !profile?.didSlug
    }
    return String(key.profile) === String(where.profile)
  }))
  const findOne = jest.fn(async ({ where }) => profiles.find(p =>
    (where.id !== undefined && String(p.id) === String(where.id)) || (where.didSlug !== undefined && p.didSlug === where.didSlug)) || null)
  return { strapi: { db: { query: () => ({ findMany, findOne }) }, config: { get: () => 'https://ignored.example' } }, findMany }
}

const KEY = (id: number, profile: number) => ({ id, profile,
  publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: Buffer.alloc(32, id).toString('base64url') } })

describe('organization DIDs (decision 0005)', () => {
  const env = { ...process.env }
  beforeEach(() => { process.env.ISSUER_DID_WEB_HOST = 'potenciacomun.example'; process.env.ISSUER_DID_WEB_PROFILE_ID = '1' })
  afterEach(() => { process.env = { ...env } })

  test('a profile with didSlug signs as did:web:<host>:org:<slug>; others keep the platform DID', async () => {
    const { strapi } = fakeStrapi([{ id: 1, didSlug: null }, { id: 7, didSlug: 'red-btb' }])
    expect(await issuerDidFor(strapi, 7)).toBe('did:web:potenciacomun.example:org:red-btb')
    expect(await issuerDidFor(strapi, 1)).toBe('did:web:potenciacomun.example')
    expect(didWebDocumentUrl(orgDid(strapi, 'red-btb'))).toBe('https://potenciacomun.example/org/red-btb/did.json')
  })

  test('organizations may sign even when the platform profile is restricted; other profiles may not', async () => {
    const { strapi } = fakeStrapi([{ id: 1 }, { id: 3 }, { id: 7, didSlug: 'red-btb' }])
    await expect(assertIssuerProfile(strapi, 7)).resolves.toBeUndefined()
    await expect(assertIssuerProfile(strapi, 1)).resolves.toBeUndefined()
    await expect(assertIssuerProfile(strapi, 3)).rejects.toThrow('not authorized')
  })

  test('each DID document lists only its own keys', async () => {
    const { strapi } = fakeStrapi([{ id: 1 }, { id: 7, didSlug: 'red-btb' }], [KEY(4, 1), KEY(5, 7)])
    const org = await issuerDidDocument(strapi, 'did:web:potenciacomun.example:org:red-btb')
    expect(org.id).toBe('did:web:potenciacomun.example:org:red-btb')
    expect(org.assertionMethod).toEqual(['did:web:potenciacomun.example:org:red-btb#key-5'])
    const platform = await issuerDidDocument(strapi)
    expect(platform.assertionMethod).toEqual(['did:web:potenciacomun.example#key-4'])
  })

  test('without a platform profile the root DID excludes organization keys', async () => {
    delete process.env.ISSUER_DID_WEB_PROFILE_ID
    const { strapi } = fakeStrapi([{ id: 1 }, { id: 7, didSlug: 'red-btb' }], [KEY(4, 1), KEY(5, 7)])
    expect((await issuerDidDocument(strapi)).assertionMethod).toEqual(['did:web:potenciacomun.example#key-4'])
  })

  test('unknown or malformed organization DIDs are rejected', async () => {
    const { strapi } = fakeStrapi([{ id: 7, didSlug: 'red-btb' }])
    await expect(issuerDidDocument(strapi, 'did:web:potenciacomun.example:org:otra')).rejects.toMatchObject({ status: 404 })
    await expect(issuerDidDocument(strapi, 'did:web:potenciacomun.example:org:Mal_Slug')).rejects.toThrow('Invalid')
    await expect(issuerDidDocument(strapi, 'did:web:otro.example')).rejects.toThrow('Not a DID of this instance')
    expect(() => orgDid(strapi, '../x')).toThrow('Invalid')
  })

  test('isLocalDid recognizes the platform and its organizations only', () => {
    const { strapi } = fakeStrapi([])
    expect(isLocalDid(strapi, 'did:web:potenciacomun.example')).toBe(true)
    expect(isLocalDid(strapi, 'did:web:potenciacomun.example:org:red-btb#key-5')).toBe(true)
    expect(isLocalDid(strapi, 'did:web:potenciacomun.example.evil')).toBe(false)
    expect(isLocalDid(strapi, 'did:web:otro.example:org:red-btb')).toBe(false)
    expect(isLocalDid(strapi, undefined)).toBe(false)
  })
})
