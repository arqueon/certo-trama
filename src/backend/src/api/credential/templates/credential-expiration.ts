import { emailBrand } from './email-brand'
import { emailLocale, esc, expirationMessages, formatDate } from './email-i18n'
interface Achievement {
  name: string
}

interface Credential {
  credentialId: string
  id: number | string
}

interface User {
  username: string
  email: string
}

interface ExpirationWarningParams {
  achievement: Achievement
  credential: Credential
  frontendUrl: string
  user: User | null
  daysLeft: number
  expirationDate: Date
}

export const generateCredentialExpirationEmail = ({
  achievement,
  credential,
  frontendUrl,
  user,
  daysLeft,
  expirationDate,
}: ExpirationWarningParams) => {
  const brand = emailBrand()
  const locale = emailLocale()
  const m = expirationMessages[locale]
  const name = esc(achievement.name)
  const formattedDate = formatDate(expirationDate, locale)

  const urgency = m.urgency(daysLeft)
  const subject = m.subject(achievement.name, urgency)

  const credentialUrl = `${frontendUrl}/credentials/${encodeURIComponent(credential.credentialId)}`
  const renewUrl = credentialUrl

  const text = `${m.willExpire(achievement.name, formattedDate, urgency)}

${m.viewText} ${credentialUrl}

${m.contactText} ${brand.support}

${m.thanks}
${brand.name}`

  const urgencyColor = daysLeft <= 1 ? '#e53e3e' : daysLeft <= 7 ? '#dd6b20' : '#d69e2e'
  const urgencyBg = daysLeft <= 1 ? '#fff5f5' : daysLeft <= 7 ? '#fffaf0' : '#fffff0'

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: ${brand.color}; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${m.heading}</h1>
  </div>

  <div style="background-color: #f7f9fc; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0; border-top: none;">

    <div style="background-color: ${urgencyBg}; border-left: 4px solid ${urgencyColor}; padding: 15px; margin-bottom: 25px; border-radius: 0 5px 5px 0;">
      <p style="margin: 0; color: ${urgencyColor}; font-weight: bold;">
        ⚠️ ${m.noticeHtml(name, urgency)}
      </p>
      <p style="margin: 5px 0 0; color: #4a5568; font-size: 14px;">${m.dateLabel} ${formattedDate}</p>
    </div>

    <p>${m.greeting(user ? esc(user.username) : undefined)}</p>
    <p>${m.reminder}</p>

    <div style="background-color: white; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 10px; color: #2d3748; font-size: 18px;">${name}</h2>
      <p style="margin: 0; color: #718096; font-size: 14px; word-break: break-all;">ID: ${esc(credential.credentialId)}</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${esc(renewUrl)}"
         style="background-color: ${brand.color}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
        ${m.button}
      </a>
    </div>

    <p style="color: #718096; font-size: 14px;">
      ${m.contactHtml}
      <a href="mailto:${esc(brand.support)}" style="color: ${brand.color};">${esc(brand.support)}</a>.
    </p>
  </div>

  <p style="text-align: center; color: #a0aec0; font-size: 12px; margin-top: 20px;">
    ${m.footer(esc(brand.name))}
  </p>
</body>
</html>`

  return { subject, text, html }
}
