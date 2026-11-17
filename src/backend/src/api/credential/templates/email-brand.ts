// Nombre del sistema y contacto de soporte en los correos al titular.
// Configurables por despliegue; por omisión, los del proyecto original.
//   EMAIL_BRAND_NAME      p. ej. «Verificación de credenciales digitales · Universidad de Guadalajara»
//   EMAIL_SUPPORT_ADDRESS correo de soporte que aparece en el mensaje
//   EMAIL_BRAND_COLOR     color de la cabecera y del botón principal (#rrggbb)
//   EMAIL_LINKEDIN_ORG_ID id de la página de LinkedIn de quien emite; sin él, el
//                         botón «Añadir a LinkedIn» usa el nombre del sistema
export function emailBrand(env: Record<string, string | undefined> = process.env) {
  const color = env.EMAIL_BRAND_COLOR?.trim()
  const linkedInOrgId = env.EMAIL_LINKEDIN_ORG_ID?.trim()
  return {
    name: env.EMAIL_BRAND_NAME?.trim() || 'Certo',
    support: env.EMAIL_SUPPORT_ADDRESS?.trim() || 'hello@schroedinger-hat.org',
    color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2d3748',
    linkedInOrgId: linkedInOrgId && /^\d+$/.test(linkedInOrgId) ? linkedInOrgId : undefined,
  }
}
