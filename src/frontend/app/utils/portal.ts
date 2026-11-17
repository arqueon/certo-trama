export function brandActive(config: Record<string, unknown>): boolean {
  return ['brandName', 'brandLogoUrl', 'brandPrimaryColor'].some(key => typeof config[key] === 'string' && !!config[key].trim())
}

// Black or white always reaches at least 4.58:1 against an opaque sRGB color.
export function contrastText(hex: string): string {
  const rgb = hex.replace('#', '').match(/.{2}/g)!.map(v => parseInt(v, 16) / 255)
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}

export function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

// An image path the page may load: same origin ("/marca/logo.svg", not
// "//host/…") or https. Anything else is dropped.
export function safeAssetUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (/^\/(?![/\\])/.test(v)) return v
  try {
    return new URL(v).protocol === 'https:' ? v : ''
  } catch { return '' }
}

export function credentialIdentifier(input: string): string {
  const value = input.trim()
  if (!/^https?:\/\//i.test(value)) return value
  const url = new URL(value)
  const match = url.pathname.match(/\/(?:credentials|verify)\/([^/]+)(?:\/(?:verify|certificate))?\/?$/)
  if (!match) throw new Error('Invalid credential URL')
  return decodeURIComponent(match[1]!)
}
