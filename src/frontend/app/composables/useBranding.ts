import { brandActive, contrastText, safeAssetUrl, safeHttpUrl } from '~/utils/portal'
export interface BrandingConfig {
  active: boolean
  /** Organización que aparece sobre el título de la portada (NUXT_PUBLIC_BRAND_ORGANIZATION); vacía, no se muestra. */
  organization: string
  catalogUrl: string
  primaryText: string
  name: string
  logoUrl: string
  /** Logotipo para fondos oscuros; vacío si no se configuró. */
  logoInverseUrl: string
  /** Emblema (p. ej. el escudo) para la medalla de la portada; si falta, el logotipo. */
  emblemUrl: string
  primaryColor: string
  /** Organization this instance is a service of (footer); null when not configured. */
  parent: { name: string, logoUrl: string, url: string } | null
}

const DEFAULT_BRANDING: BrandingConfig = {
  active: false,
  organization: '',
  catalogUrl: '',
  primaryText: '#000000',
  name: 'Certo',
  logoUrl: '/certo-logo-text.png',
  logoInverseUrl: '',
  emblemUrl: '',
  primaryColor: '#5AB69F',
  parent: null,
}

function validColor(value: string | undefined): string {
  if (!value) {
    return DEFAULT_BRANDING.primaryColor
  }

  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_BRANDING.primaryColor
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function useBranding(): BrandingConfig {
  const config = useRuntimeConfig()
  const publicConfig = config.public as Record<string, unknown>

  const primaryColor = validColor(publicConfig.brandPrimaryColor as string)
  return {
    active: brandActive(publicConfig),
    organization: typeof publicConfig.brandOrganization === 'string' ? publicConfig.brandOrganization.trim() : '',
    catalogUrl: safeHttpUrl(publicConfig.catalogUrl),
    primaryText: contrastText(primaryColor),
    name: typeof publicConfig.brandName === 'string' && publicConfig.brandName.trim()
      ? publicConfig.brandName.trim()
      : DEFAULT_BRANDING.name,
    logoUrl: typeof publicConfig.brandLogoUrl === 'string' && publicConfig.brandLogoUrl.trim()
      ? publicConfig.brandLogoUrl.trim()
      : DEFAULT_BRANDING.logoUrl,
    logoInverseUrl: text(publicConfig.brandLogoInverseUrl),
    emblemUrl: text(publicConfig.brandEmblemUrl) || text(publicConfig.brandLogoUrl) || DEFAULT_BRANDING.logoUrl,
    primaryColor: validColor(typeof publicConfig.brandPrimaryColor === 'string'
      ? publicConfig.brandPrimaryColor
      : undefined),
    parent: text(publicConfig.brandParentName)
      ? {
          name: text(publicConfig.brandParentName),
          logoUrl: safeAssetUrl(publicConfig.brandParentLogoUrl),
          url: safeHttpUrl(text(publicConfig.brandParentUrl)),
        }
      : null,
  }
}
