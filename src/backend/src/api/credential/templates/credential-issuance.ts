import { emailBrand } from './email-brand'
import { emailLocale, esc, issuanceMessages } from './email-i18n'
// src/backend/src/api/credential/templates/credential-issuance.ts

interface Achievement {
  name: string
}

interface Credential {
  credentialId: string
}

interface User {
  username: string
  email: string
}

interface TemplateParams {
  achievement: Achievement
  credential: Credential
  frontendUrl: string
  user: User | null
}

export const generateCredentialIssuanceEmail = ({ achievement, credential, frontendUrl, user }: TemplateParams) => {
  const brand = emailBrand()
  const locale = emailLocale()
  const m = issuanceMessages[locale]
  const name = esc(achievement.name)
  const credentialUrl = `${frontendUrl}/credentials/${credential.credentialId}`
  const subject = m.subject(achievement.name)

  const text = `${m.heading} ${m.awarded(achievement.name)}

${m.viewText} ${credentialUrl}

${m.linkedinText} ${frontendUrl}/linkedin

${m.support} ${brand.support}

${user ? `
${m.accountText}
${m.username}: ${user.username}
${m.email}: ${user.email}

${m.setPasswordText} ${frontendUrl}/forgot-password
` : ''}

${m.thanks}
${brand.name}`

  // LinkedIn's add-to-profile link: the issuer's page id when the deployment has
  // one, otherwise just the system name (never someone else's organization id).
  const linkedInOrg = brand.linkedInOrgId
    ? `organizationId=${brand.linkedInOrgId}`
    : `organizationName=${encodeURIComponent(brand.name)}`
  const linkedInUrl = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(achievement.name)}&${linkedInOrg}&issueYear=${new Date().getFullYear()}&certId=${encodeURIComponent(credential.credentialId)}&certUrl=${encodeURIComponent(credentialUrl)}`

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';">
  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 20px;">
        <!--[if mso]>
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" align="center">
        <tr>
        <td>
        <![endif]-->
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${brand.color}; padding: 24px; text-align: center; border-top-left-radius: 8px; border-top-right-radius: 8px;">
              <h1 style="margin: 0; font-size: 24px; color: #ffffff; font-weight: bold;">${esc(brand.name)}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin-top: 0; color: #2d3748; font-size: 22px;">${m.heading}</h2>
              <p style="margin: 0; color: #4a5568; line-height: 1.6;">${m.awardedHtml(name)}</p>
              
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; margin-top: 32px; margin-bottom: 16px;">
                <tr>
                  <td align="center">
                    <a href="${esc(credentialUrl)}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: ${brand.color}; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 6px;">${m.viewButton}</a>
                  </td>
                </tr>
              </table>
              <!-- LinkedIn Add to Profile Button -->
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; margin-bottom: 32px;">
                <tr>
                  <td align="center">
                    <a href="${esc(linkedInUrl)}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #0077b5; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 6px;">
                      ${m.linkedinButton}
                    </a>
                  </td>
                </tr>
              </table>

              <div style="margin: 24px 0; padding: 16px; background: #f3f4f6; border-radius: 6px; text-align: center;">
                <strong>${m.linkedinQuestion}</strong><br />
                <a href="${frontendUrl}/linkedin" style="color: #0077b5; text-decoration: underline;">${m.linkedinGuide}</a>
              </div>

              <div style="margin: 24px 0; padding: 16px; background: #fef9c3; border-radius: 6px; text-align: center; color: #92400e;">
                ${m.support} <a href="mailto:${esc(brand.support)}" style="color: #92400e; text-decoration: underline;">${esc(brand.support)}</a>
              </div>

              ${user ? `
                <hr style="border: 0; height: 1px; background-color: #e2e8f0; margin: 0;" />
                <div style="padding-top: 32px; padding-bottom: 32px;">
                  <h3 style="margin-top: 0; color: #2d3748; font-size: 20px;">${m.accountTitle}</h3>
                  <p style="margin: 0; color: #4a5568; line-height: 1.6;">${m.accountHtml}</p>
                  <div style="background-color: #edf2f7; border-radius: 6px; padding: 20px; margin-top: 24px; margin-bottom: 24px;">
                    <p style="margin: 0 0 10px 0; color: #4a5568;"><strong>${m.username}:</strong> ${esc(user.username)}</p>
                    <p style="margin: 0; color: #4a5568;"><strong>${m.email}:</strong> ${esc(user.email)}</p>
                  </div>
                  <p style="margin: 0; color: #4a5568; line-height: 1.6;">${m.setPasswordHtml}</p>
                </div>
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%;">
                  <tr>
                    <td align="center">
                      <a href="${frontendUrl}/forgot-password" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #4a5568; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 6px;">${m.setPasswordButton}</a>
                    </td>
                  </tr>
                </table>
              ` : ''}

            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center; background-color: #edf2f7; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #718096;">${m.footer(esc(brand.name))}</p>
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, text, html }
} 