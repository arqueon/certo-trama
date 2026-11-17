import { generateCredentialExpirationEmail } from '../credential-expiration'
import { generateCredentialIssuanceEmail } from '../credential-issuance'
import { emailLocale, esc } from '../email-i18n'

const base = { credential: { credentialId: 'urn:uuid:x' }, frontendUrl: 'https://portal.example.org', user: null }

describe('holder email language', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('defaults to English and reads EMAIL_LOCALE', () => {
    expect(emailLocale({})).toBe('en')
    expect(emailLocale({ EMAIL_LOCALE: 'es-MX' })).toBe('es')
    expect(emailLocale({ EMAIL_LOCALE: 'fr' })).toBe('en')
  })

  it('keeps the upstream English subject by default', () => {
    delete process.env.EMAIL_LOCALE
    const mail = generateCredentialIssuanceEmail({ ...base, achievement: { name: 'Badge' } })
    expect(mail.subject).toBe("You've received a new credential: Badge")
    expect(mail.html).toContain('<html lang="en">')
  })

  it('writes the issuance email in Spanish', () => {
    process.env.EMAIL_LOCALE = 'es'
    const mail = generateCredentialIssuanceEmail({ ...base, achievement: { name: 'Cuidados digitales' }, user: { username: 'ana', email: 'ana@example.org' } })
    expect(mail.subject).toBe('Recibiste una credencial nueva: Cuidados digitales')
    expect(mail.html).toContain('<html lang="es">')
    expect(mail.html).toContain('Ver tu credencial')
    expect(mail.text).toContain('Para crear tu contraseña')
    expect(mail.html).not.toMatch(/Congratulations|All rights reserved/)
  })

  it('writes the expiration email in Spanish with a Mexican date', () => {
    process.env.EMAIL_LOCALE = 'es'
    const mail = generateCredentialExpirationEmail({
      ...base, credential: { credentialId: 'urn:uuid:x', id: 1 }, achievement: { name: 'Badge' },
      daysLeft: 5, expirationDate: new Date('2026-12-01T12:00:00Z'),
    })
    expect(mail.subject).toBe('Tu credencial «Badge» vence en 5 días')
    expect(mail.text).toContain('1 de diciembre de 2026')
  })

  it('never uses a third-party LinkedIn organization id or remote image', () => {
    const mail = generateCredentialIssuanceEmail({ ...base, achievement: { name: 'Badge' } })
    expect(mail.html).not.toContain('53115782')
    expect(mail.html).not.toContain('download.linkedin.com')
    expect(mail.html).toContain('organizationName=')
    process.env.EMAIL_LINKEDIN_ORG_ID = '123'
    expect(generateCredentialIssuanceEmail({ ...base, achievement: { name: 'Badge' } }).html).toContain('organizationId=123')
  })

  it('escapes issuer-supplied text in the HTML', () => {
    const mail = generateCredentialIssuanceEmail({ ...base, achievement: { name: '<img src=x onerror=alert(1)>' } })
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain(esc('<img src=x onerror=alert(1)>'))
  })
})
