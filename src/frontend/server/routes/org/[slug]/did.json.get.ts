/** did:web:<host>:org:<slug> → /org/<slug>/did.json (decision 0005). */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') || ''
  if (!SLUG.test(slug)) throw createError({ statusCode: 404, statusMessage: 'Unknown organization DID' })
  const config = useRuntimeConfig(event)
  const base = String(config.issuerDidBackendUrl || config.public.apiUrl || '').replace(/\/$/, '')
  if (!base) throw createError({ statusCode: 503, statusMessage: 'DID backend URL is not configured' })
  const document = await $fetch(`${base}/api/issuer/org/${slug}/did.json`, { timeout: 10000 }).catch((error: any) => {
    throw createError({ statusCode: error?.statusCode === 404 ? 404 : 502, statusMessage: 'Organization DID unavailable' })
  })
  setResponseHeader(event, 'Content-Type', 'application/did+ld+json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  return document
})
