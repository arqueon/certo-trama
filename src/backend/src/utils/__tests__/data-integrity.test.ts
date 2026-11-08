import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { assertIssuerProfile, issuerDid, issuerDidDocument, publicMultikey } from '../issuer-did'
import { localDocumentLoader, signCredential, verificationLoader, verifyDataIntegrity } from '../data-integrity'
import { fixture } from '../../api/credential/services/__tests__/interop-fixture'
import verification from '../../api/credential/services/verification'

const dcc = (credential: any, didDocument: any, statusList?: any, core = false): Promise<any> => new Promise((resolveResult, reject) => {
  const child = execFile(process.execPath, [resolve('scripts/qa/dcc-local.mjs'), ...(core ? ['--core'] : [])], { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(`${error.message}: ${stderr}`))
    try { resolveResult(JSON.parse(stdout)) } catch (error) { reject(error) }
  })
  child.stdin.end(JSON.stringify({ credential, didDocument, statusList }))
})

describe('did:web and Data Integrity interoperability', () => {
  test('encodes RFC 8032 Ed25519 test vector 1 as Multikey and never exposes private fields', async () => {
    const key = await publicMultikey('did:web:example.test', { id: 4, publicKeyJwk: {
      kty: 'OKP', crv: 'Ed25519',
      x: Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex').toString('base64url'),
      d: 'must-not-escape',
    } })
    expect(key.publicKeyMultibase).toBe('z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw')
    expect(Object.keys(key).sort()).toEqual(['@context', 'controller', 'id', 'publicKeyMultibase', 'type'])
  })

  test('derives the host and percent-encodes a port', () => {
    expect(issuerDid({ config: { get: () => 'https://example.test:8443/some/path' } }))
      .toBe('did:web:example.test%3A8443')
  })

  test('explicit host/profile configuration restricts signing and public key selection', async () => {
    const oldHost = process.env.ISSUER_DID_WEB_HOST
    const oldProfile = process.env.ISSUER_DID_WEB_PROFILE_ID
    process.env.ISSUER_DID_WEB_HOST = 'badges.example.test'
    process.env.ISSUER_DID_WEB_PROFILE_ID = '9'
    try {
      const findMany = jest.fn().mockResolvedValue([])
      const findOne = jest.fn().mockResolvedValue(null)
      const strapi = { db: { query: () => ({ findMany, findOne }) } }
      expect(issuerDid(strapi)).toBe('did:web:badges.example.test')
      await expect(assertIssuerProfile(strapi, 3)).rejects.toThrow('not authorized')
      await expect(assertIssuerProfile(strapi, 9)).resolves.toBeUndefined()
      expect((await issuerDidDocument(strapi)).verificationMethod).toEqual([])
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        select: ['id', 'publicKeyJwk'], where: { status: { $in: ['active', 'retired'] }, profile: '9' },
      }))
    } finally {
      if (oldHost === undefined) delete process.env.ISSUER_DID_WEB_HOST; else process.env.ISSUER_DID_WEB_HOST = oldHost
      if (oldProfile === undefined) delete process.env.ISSUER_DID_WEB_PROFILE_ID; else process.env.ISSUER_DID_WEB_PROFILE_ID = oldProfile
    }
  })

  test('local contexts are available and unknown documents fail without HTTP', async () => {
    const loader = await localDocumentLoader()
    for (const url of ['https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json', 'https://w3id.org/security/data-integrity/v2',
      'https://w3id.org/security/multikey/v1', 'https://www.w3.org/ns/did/v1']) {
      expect((await loader(url)).document['@context']).toBeDefined()
    }
    await expect(loader('https://unknown.example/context')).rejects.toThrow('local loader')
  })

  test('signing and local verification work with fetch forbidden', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network forbidden'))
    try {
      const { vc, strapi } = await fixture()
      expect(await verifyDataIntegrity(vc, await verificationLoader(strapi, vc))).toEqual({ valid: true })
      expect(fetcher).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })

  test('DCC verifies an emitted OB3 credential AND its signed Bitstring status list offline', async () => {
    const { vc, strapi, services, status } = await fixture()
    const did = await issuerDidDocument(strapi)
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    expect(list['@context']).toEqual(['https://www.w3.org/ns/credentials/v2'])
    expect(list.issuer).toBe(vc.issuer.id)
    expect(list.proof.cryptosuite).toBe('eddsa-rdfc-2022')
    const result = await dcc(vc, did, list)
    expect(result).toMatchObject({ verified: true, statusResult: { verified: true } })
    expect((await dcc(list, did)).verified).toBe(true)
    expect((await services['api::credential.open-badge'].validateExternalCredential(vc)).verified).toBe(true)
  })

  test('DCC and the portal reject a revoked credential and a tampered status list', async () => {
    const { vc, strapi, services, status } = await fixture()
    const { decodeList } = await import('@digitalbazaar/vc-bitstring-status-list')
    const bits = await decodeList({ encodedList: status.encodedList })
    bits.setStatus(0, true)
    status.encodedList = await bits.encode()
    const did = await issuerDidDocument(strapi)
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    expect((await dcc(vc, did, list)).verified).toBe(false)
    expect((await services['api::credential.open-badge'].validateExternalCredential(vc)).verified).toBe(false)
    list.credentialSubject.encodedList += 'x'
    expect((await dcc(vc, did, list)).verified).toBe(false)
  })

  test('verifier-core beta.11 accepts the signature, status and OB3 schema through its real resolver', async () => {
    const { vc, strapi, services, status } = await fixture()
    const did = await issuerDidDocument(strapi)
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    const result = await dcc(vc, did, list, true)
    expect(result.errors).toBeUndefined()
    expect(result.log).toEqual(expect.arrayContaining([
      { id: 'valid_signature', valid: true }, { id: 'revocation_status', valid: true }, { id: 'expiration', valid: true },
    ]))
    expect(result.additionalInformation[0].results[0].result).toEqual({ valid: true })
  })

  test('omits Strapi null optional fields before signing so the real OB3 schema accepts evidence', async () => {
    const { record, strapi, services, status } = await fixture()
    delete record.signedCredential
    record.evidence[0].narrative = null
    record.evidence[0].genre = null
    record.evidence[0].audience = null
    record.achievement.alignment[0].targetDescription = null
    const vc = await services['api::credential.open-badge'].serializeCredential(1, true)
    expect(vc.evidence[0]).not.toHaveProperty('narrative')
    expect(vc.evidence[0]).not.toHaveProperty('genre')
    expect(vc.evidence[0]).not.toHaveProperty('audience')
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    const result = await dcc(vc, await issuerDidDocument(strapi), list, true)
    expect(result.errors).toBeUndefined()
    expect(result.additionalInformation[0].results[0].result).toEqual({ valid: true })
  })

  test('retired public keys still verify after the active signing key changes', async () => {
    const { vc, strapi, keys, services, status } = await fixture()
    const { generateKeyPair, exportJWK } = await import('jose')
    const next = await generateKeyPair('EdDSA')
    const nextJwk = await exportJWK(next.publicKey)
    keys.push({ id: 5, publicKeyJwk: nextJwk })
    services['api::profile.issuer-keys'].getOrCreateKeyPair = async () => ({ ...next, publicKeyJwk: nextJwk, keyId: 5 })
    const did = await issuerDidDocument(strapi)
    expect(did.assertionMethod).toEqual([`${did.id}#key-4`, `${did.id}#key-5`])
    expect(did.authentication).toEqual(did.assertionMethod)
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    expect(list.proof.verificationMethod).toBe(`${did.id}#key-5`)
    expect((await dcc(vc, did, list)).verified).toBe(true)
  })

  test('rejects changes to signed claims and to stored display data', async () => {
    const { vc, record, strapi, services, status } = await fixture()
    record.name = 'Altered display'
    expect((await verification.verifyProof(record)).valid).toBe(false)
    const did = await issuerDidDocument(strapi)
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    for (const change of [
      (doc: any) => { doc.name = 'Altered credential' },
      (doc: any) => { doc.credentialSubject.result[0].achievedLevel = 'urn:other' },
      (doc: any) => { doc.credentialSubject.awardedDate = '2020-01-01T00:00:00Z' },
      (doc: any) => { doc.proof.proofPurpose = 'authentication' },
      (doc: any) => { doc.issuer.id = 'did:web:other.example.test' },
    ]) {
      const altered = structuredClone(vc); change(altered)
      expect((await dcc(altered, did, list)).verified).toBe(false)
    }
  })

  test.each(['expired', 'future'])('the portal and DCC reject a %s VC 2.0 validity interval', async mode => {
    const { vc, strapi, services, status } = await fixture()
    const change = mode === 'expired' ? { validUntil: '2020-01-01T00:00:00Z' } : { validFrom: '2099-01-01T00:00:00Z' }
    const document = await signCredential(strapi, 3, { ...vc, ...change })
    const list = await services['api::revocation-list.revocation-list'].serializeCredential(status)
    expect((await dcc(document, await issuerDidDocument(strapi), list)).verified).toBe(false)
    expect((await services['api::credential.open-badge'].validateExternalCredential(document)).verified).toBe(false)
  })

  test('refuses signing unknown JSON-LD terms and verifies issuer assertion authorization', async () => {
    const { vc, strapi } = await fixture()
    await expect(signCredential(strapi, 3, { ...vc, unknownClaim: 'silently dropped?' })).rejects.toThrow()
    const loader = await verificationLoader(strapi, vc)
    const restrictedLoader = async (url: string) => {
      const result = await loader(url)
      if (url === vc.issuer.id) result.document.assertionMethod = []
      return result
    }
    expect((await verifyDataIntegrity(vc, restrictedLoader)).valid).toBe(false)
  })
})
