import { ORG_SLUG, issuerDidDocument, orgDid } from '../../../utils/issuer-did'

export default {
  async document(ctx) {
    ctx.set('Cache-Control', 'no-store')
    ctx.body = await issuerDidDocument(strapi)
    ctx.set('Content-Type', 'application/did+ld+json')
  },

  async organization(ctx) {
    const slug = String(ctx.params.slug || '')
    if (!ORG_SLUG.test(slug)) return ctx.notFound('Unknown organization DID')
    ctx.set('Cache-Control', 'no-store')
    try {
      ctx.body = await issuerDidDocument(strapi, orgDid(strapi, slug))
    } catch (error: any) {
      if (error?.status === 404) return ctx.notFound('Unknown organization DID')
      throw error
    }
    ctx.set('Content-Type', 'application/did+ld+json')
  },
}
