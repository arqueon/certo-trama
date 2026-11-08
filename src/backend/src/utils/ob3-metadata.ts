import { createHash } from 'node:crypto'

// Only named transport fields survive. Unknown keys (including @context) are
// ignored, never merged into a signed JSON-LD document.
type ObjectValue = Record<string, any>
function fail(path: string, reason: string): never { throw new Error(`Metadatos: ${path} ${reason}`) }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'debe ser un objeto')
  return value as ObjectValue
}
function text(value: unknown, path: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path, `debe ser texto no vacío de hasta ${max} caracteres`)
  return value.trim()
}
export function httpsUrl(value: unknown, path: string): string {
  const result = text(value, path, 2048)
  try {
    const url = new URL(result)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || /\s/.test(result)) fail(path, 'debe ser una URL https sin credenciales')
  } catch { fail(path, 'debe ser una URL https sin credenciales') }
  return result
}
function identifier(value: unknown, path: string): string {
  const result = text(value, path, 2048)
  return /^urn:[a-z0-9][a-z0-9-]{0,31}:\S+$/i.test(result) ? result : httpsUrl(result, path)
}
function array(value: unknown, path: string, max = 100): any[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `debe ser una lista de hasta ${max} elementos`)
  return value as any[]
}
function type(value: unknown, expected: string, path: string) {
  if (value !== undefined && value !== expected && !(Array.isArray(value) && value.length === 1 && value[0] === expected)) fail(path, `debe ser ${expected}`)
}
function strings(input: ObjectValue, output: ObjectValue, path: string, fields: Record<string, number>) {
  for (const [key, max] of Object.entries(fields)) if (input[key] !== undefined) output[key] = text(input[key], `${path}.${key}`, max)
}
function credits(value: unknown, path: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) fail(path, 'debe ser un número entre 0 y 10000')
  return value
}
function profile(value: unknown, path: string, depth = 0): ObjectValue {
  const input = object(value, path), out: ObjectValue = { type: ['Profile'], name: text(input.name, `${path}.name`) }
  type(input.type, 'Profile', `${path}.type`)
  if (input.id !== undefined) out.id = identifier(input.id, `${path}.id`)
  if (input.url !== undefined) out.url = httpsUrl(input.url, `${path}.url`)
  if (input.image !== undefined) {
    const img = typeof input.image === 'string' ? { id: input.image } : object(input.image, `${path}.image`)
    type(img.type, 'Image', `${path}.image.type`)
    out.image = { id: httpsUrl(img.id, `${path}.image.id`), type: 'Image' }
  }
  // A deterministic local identity is not a claim of registry membership.
  out.id ||= out.url || `urn:certo:profile:${createHash('sha256').update(out.name).digest('hex')}`
  if (input.parentOrg !== undefined) {
    if (depth >= 1) fail(`${path}.parentOrg`, 'supera la profundidad permitida')
    out.parentOrg = profile(input.parentOrg, `${path}.parentOrg`, depth + 1)
  }
  return out
}
export function normalizeCriteria(value: unknown, path = 'achievement.criteria'): ObjectValue {
  const input = object(value, path), out: ObjectValue = {}
  strings(input, out, path, { narrative: 20000 })
  if (input.id !== undefined) out.id = httpsUrl(input.id, `${path}.id`)
  if (input.url !== undefined) {
    const url = httpsUrl(input.url, `${path}.url`)
    if (out.id && out.id !== url) fail(path, 'id y url deben coincidir')
    out.id = url
  }
  return out
}
const alignmentTypes = ['ceasn:Competency', 'ceterms:Credential', 'CFItem', 'CFRubric', 'CFRubricCriterion', 'CFRubricCriterionLevel', 'CTDL']
export function normalizeAchievementMetadata(value: unknown): ObjectValue | undefined {
  if (value === undefined) return undefined
  const input = object(value, 'achievement'), out: ObjectValue = {}
  strings(input, out, 'achievement', { description: 20000, fieldOfStudy: 1000, inLanguage: 64, humanCode: 128, version: 64 })
  if (out.inLanguage && !/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(out.inLanguage)) fail('achievement.inLanguage', 'debe ser una etiqueta de idioma')
  if (input.creator !== undefined) out.creator = profile(input.creator, 'achievement.creator')
  if (input.creditsAvailable !== undefined) out.creditsAvailable = credits(input.creditsAvailable, 'achievement.creditsAvailable')
  if (input.criteria !== undefined) out.criteria = normalizeCriteria(input.criteria)
  if (input.tag !== undefined) out.tag = array(input.tag, 'achievement.tag', 50).map((v, i) => text(v, `achievement.tag[${i}]`, 200))
  if (input.alignment !== undefined) out.alignment = array(input.alignment, 'achievement.alignment').map((v, i) => {
    const path = `achievement.alignment[${i}]`, a = object(v, path)
    type(a.type, 'Alignment', `${path}.type`)
    const result: ObjectValue = { type: ['Alignment'], targetName: text(a.targetName, `${path}.targetName`, 2000) }
    strings(a, result, path, { targetCode: 128, targetDescription: 4000, targetFramework: 500 })
    if (a.targetUrl !== undefined) result.targetUrl = httpsUrl(a.targetUrl, `${path}.targetUrl`)
    if (a.targetType !== undefined) {
      result.targetType = text(a.targetType, `${path}.targetType`, 100)
      if (!alignmentTypes.includes(result.targetType) && !/^ext:[a-zA-Z0-9._-]+$/.test(result.targetType)) fail(`${path}.targetType`, 'no pertenece a AlignmentTargetType')
    } else if (a.targetFramework === 'Resultados de aprendizaje') result.targetType = 'ceasn:Competency'
    else if (['Marco Nacional de Cualificaciones (SEP)', 'Marco institucional CGAI'].includes(a.targetFramework)) result.targetType = 'ext:QualificationLevel'
    return result
  })
  return out
}
function date(value: unknown, path: string) {
  const result = text(value, path, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) fail(path, 'debe ser una fecha UTC válida (ISO 8601)')
  return result
}
export function normalizeSubjectMetadata(value: unknown): ObjectValue | undefined {
  if (value === undefined) return undefined
  const input = object(value, 'subject'), out: ObjectValue = {}
  strings(input, out, 'subject', { name: 500, term: 200, description: 4000 })
  if (input.tag !== undefined) out.tag = array(input.tag, 'subject.tag', 50).map((v, i) => text(v, `subject.tag[${i}]`, 200))
  if (input.source !== undefined) out.source = profile(input.source, 'subject.source')
  if (input.creditsEarned !== undefined) out.creditsEarned = credits(input.creditsEarned, 'subject.creditsEarned')
  for (const key of ['activityStartDate', 'activityEndDate']) if (input[key] !== undefined) out[key] = date(input[key], `subject.${key}`)
  if (out.activityStartDate && out.activityEndDate && Date.parse(out.activityStartDate) > Date.parse(out.activityEndDate)) fail('subject.activityEndDate', 'debe ser posterior o igual al inicio')
  // Reserved by the agreed contract. Do not accept CURP or replace Certo's
  // per-credential salted email identity through an unagreed extension.
  if (input.identifiers !== undefined && array(input.identifiers, 'subject.identifiers').length) fail('subject.identifiers', 'está reservado; solo se admite una lista vacía en 0023')
  return out
}
export function achievementClaims(metadata: ObjectValue | undefined, achievementUrl: string, criteria?: ObjectValue) {
  if (!metadata) return {}
  const out = structuredClone(metadata)
  if (out.alignment) out.alignment = out.alignment.map((a: ObjectValue) => ({
    ...a,
    // The catalogue/version documents the declared outcome or level. Do not
    // fabricate a SEP URL or imply a CASE identifier supplied by that body.
    targetUrl: a.targetUrl || out.criteria?.id || criteria?.id || achievementUrl,
  }))
  return out
}
export function subjectClaims(metadata: ObjectValue | undefined) {
  if (!metadata) return {}
  const { tag, ...out } = structuredClone(metadata)
  // tag is scoped to Achievement in OB3; subject.tag would be undefined.
  if (tag?.length) out.narrative = `Programa o evento: ${tag.join('; ')}`
  return out
}
/**
 * OB 3.0 issuer Profile. An organization with its own DID (profile.didSlug,
 * decision 0005) is described by its own profile row: name, https site and
 * image. Address is omitted for organizations: the platform's ISSUER_PROFILE_*
 * describe the platform only and are never put on another organization's name.
 */
export function issuerProfile(strapi: any, did: string, profile?: any) {
  const base = (process.env.PUBLIC_URL || strapi.config.get('server.url') || '').replace(/\/$/, '')
  if (profile?.didSlug) {
    const image = profile.image?.url
      ? (String(profile.image.url).startsWith('http') ? httpsUrl(profile.image.url, 'issuer.image') : `${base}${profile.image.url}`)
      : undefined
    return {
      id: did, type: ['Profile'],
      name: text(profile.name, 'issuer.name'),
      ...(profile.url ? { url: httpsUrl(profile.url, 'issuer.url') } : {}),
      ...(image ? { image: { id: image, type: 'Image' } } : {}),
    }
  }
  const address = text(process.env.ISSUER_PROFILE_ADDRESS || 'Jalisco, MX', 'ISSUER_PROFILE_ADDRESS', 200).split(',').map(s => s.trim())
  if (address.length !== 2 || !address[0] || !/^[A-Z]{2}$/.test(address[1])) fail('ISSUER_PROFILE_ADDRESS', 'debe tener el formato Región, CC')
  // Local HTTP origins remain possible for isolated QA, never for configured
  // external profile URLs or images.
  // Sin marca en el código (credenciales-comunitarias, decisión 0011): el nombre
  // y la URL del emisor los pone cada despliegue. Sin ellos no se emite, para no
  // firmar nunca a nombre de otra institución.
  const defaultImage = `${base}/marca/emisor.png`
  if (!process.env.ISSUER_PROFILE_NAME?.trim()) fail('ISSUER_PROFILE_NAME', 'es obligatorio: nombre de quien emite')
  if (!process.env.ISSUER_PROFILE_URL?.trim()) fail('ISSUER_PROFILE_URL', 'es obligatorio: sitio https de quien emite')
  return {
    id: did, type: ['Profile'],
    name: text(process.env.ISSUER_PROFILE_NAME, 'ISSUER_PROFILE_NAME'),
    url: httpsUrl(process.env.ISSUER_PROFILE_URL!, 'ISSUER_PROFILE_URL'),
    image: { id: process.env.ISSUER_PROFILE_IMAGE ? httpsUrl(process.env.ISSUER_PROFILE_IMAGE, 'ISSUER_PROFILE_IMAGE') : defaultImage, type: 'Image' },
    address: { type: ['Address'], addressRegion: address[0], addressCountryCode: address[1] },
  }
}
