// Language of the holder emails (issuance and expiration), per deployment.
//   EMAIL_LOCALE  `es` or `en` (default `en`, the upstream text)
// Values interpolated into the HTML go through `esc`: an achievement name is
// issuer-supplied text and must not become markup in someone's inbox.

export type EmailLocale = 'en' | 'es'

export function emailLocale(env: Record<string, string | undefined> = process.env): EmailLocale {
  return env.EMAIL_LOCALE?.trim().toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatDate(date: Date, locale: EmailLocale): string {
  return date.toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export const issuanceMessages = {
  en: {
    subject: (name: string) => `You've received a new credential: ${name}`,
    heading: 'Congratulations!',
    awarded: (name: string) => `You have been awarded the "${name}" credential.`,
    awardedHtml: (name: string) => `You have been awarded the "<strong>${name}</strong>" credential.`,
    viewText: 'View your credential at:',
    viewButton: 'View Your Credential',
    linkedinText: 'Follow our LinkedIn guide to add this credential to your LinkedIn profile:',
    linkedinButton: 'Add to LinkedIn',
    linkedinQuestion: 'Want to add this credential to your LinkedIn profile?',
    linkedinGuide: 'Follow our LinkedIn guide',
    support: 'If you need any support or have any question please contact us at',
    accountText: 'A user account has been created for you to manage your credentials.',
    accountTitle: 'Your Account Information',
    accountHtml: 'A user account has been created for you to manage your credentials and discover new opportunities.',
    username: 'Username',
    email: 'Email',
    setPasswordText: 'To set your password, please visit:',
    setPasswordHtml: 'To set your password and access your account, please click the button below and enter your email address.',
    setPasswordButton: 'Set Your Password',
    thanks: 'Thank you,',
    footer: (brand: string) => `You received this email because you were issued a credential through ${brand}.`,
  },
  es: {
    subject: (name: string) => `Recibiste una credencial nueva: ${name}`,
    heading: '¡Felicidades!',
    awarded: (name: string) => `Te otorgaron la credencial «${name}».`,
    awardedHtml: (name: string) => `Te otorgaron la credencial «<strong>${name}</strong>».`,
    viewText: 'Consulta tu credencial en:',
    viewButton: 'Ver tu credencial',
    linkedinText: 'Para añadirla a tu perfil de LinkedIn, sigue la guía:',
    linkedinButton: 'Añadir a LinkedIn',
    linkedinQuestion: '¿Quieres añadir esta credencial a tu perfil de LinkedIn?',
    linkedinGuide: 'Sigue la guía',
    support: 'Si necesitas ayuda o tienes dudas, escríbenos a',
    accountText: 'Creamos una cuenta para que administres tus credenciales.',
    accountTitle: 'Tu cuenta',
    accountHtml: 'Creamos una cuenta para que administres tus credenciales y decidas qué información compartes.',
    username: 'Usuario',
    email: 'Correo',
    setPasswordText: 'Para crear tu contraseña, entra a:',
    setPasswordHtml: 'Para crear tu contraseña y entrar a tu cuenta, usa el botón y escribe tu correo.',
    setPasswordButton: 'Crear tu contraseña',
    thanks: 'Gracias,',
    footer: (brand: string) => `Recibiste este correo porque se te otorgó una credencial por medio de ${brand}.`,
  },
} as const

export const expirationMessages = {
  en: {
    urgency: (daysLeft: number) => (daysLeft <= 1 ? 'expires today' : `expires in ${daysLeft} days`),
    subject: (name: string, urgency: string) => `Your credential "${name}" ${urgency}`,
    willExpire: (name: string, date: string, urgency: string) => `Your credential "${name}" will expire on ${date} (${urgency}).`,
    viewText: 'View and renew your credential at:',
    contactText: 'If you have any questions, please contact the issuer or reach us at',
    heading: 'Credential Expiration Notice',
    noticeHtml: (name: string, urgency: string) => `Your credential <strong>${name}</strong> ${urgency}.`,
    dateLabel: 'Expiration date:',
    greeting: (username?: string) => (username ? `Hi ${username},` : 'Hello,'),
    reminder: 'This is a reminder that your credential will expire soon. Please take action to renew it if needed.',
    button: 'View &amp; Renew Credential',
    contactHtml: 'If you believe this is an error or have questions, please contact the credential issuer or reach us at',
    thanks: 'Thank you,',
    footer: (brand: string) => `You received this email because you hold a credential managed through ${brand}.`,
  },
  es: {
    urgency: (daysLeft: number) => (daysLeft <= 1 ? 'vence hoy' : `vence en ${daysLeft} días`),
    subject: (name: string, urgency: string) => `Tu credencial «${name}» ${urgency}`,
    willExpire: (name: string, date: string, urgency: string) => `Tu credencial «${name}» vence el ${date} (${urgency}).`,
    viewText: 'Consúltala y renuévala en:',
    contactText: 'Si tienes dudas, escribe a la organización que la emitió o a',
    heading: 'Aviso de vencimiento',
    noticeHtml: (name: string, urgency: string) => `Tu credencial <strong>${name}</strong> ${urgency}.`,
    dateLabel: 'Fecha de vencimiento:',
    greeting: (username?: string) => (username ? `Hola, ${username}:` : 'Hola:'),
    reminder: 'Te recordamos que tu credencial vencerá pronto. Si hace falta, pide su renovación.',
    button: 'Ver y renovar la credencial',
    contactHtml: 'Si crees que es un error o tienes dudas, escribe a la organización que emitió la credencial o a',
    thanks: 'Gracias,',
    footer: (brand: string) => `Recibiste este correo porque tienes una credencial administrada por medio de ${brand}.`,
  },
} as const
