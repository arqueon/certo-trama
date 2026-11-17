import { generateCredentialIssuanceEmail } from '../credential-issuance'
import { emailBrand } from '../email-brand'

describe('email brand', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('keeps the upstream defaults when nothing is configured', () => {
    expect(emailBrand({})).toEqual({ name: 'Certo', support: 'hello@schroedinger-hat.org', color: '#2d3748', linkedInOrgId: undefined })
  })

  it('names the configured system and support address in the issuance email', () => {
    process.env.EMAIL_BRAND_NAME = 'Verificación de credenciales digitales · Universidad de Guadalajara'
    process.env.EMAIL_SUPPORT_ADDRESS = 'soporte@example.org'
    const mail = generateCredentialIssuanceEmail({ achievement: { name: 'Badge' }, credential: { credentialId: 'urn:uuid:x' }, frontendUrl: 'https://portal.example.org', user: null })
    expect(mail.html).toContain('>Verificación de credenciales digitales · Universidad de Guadalajara</h1>')
    expect(mail.text).toContain('soporte@example.org')
    expect(mail.html).toContain('href="https://portal.example.org/linkedin"')
    expect(mail.html).not.toMatch(/Certo|schroedinger/)
  })
})
