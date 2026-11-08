export default {
  routes: [
    { method: 'GET', path: '/issuer/did.json', handler: 'issuer-did.document',
      config: { auth: false, policies: [], middlewares: [] } },
    // did:web:<host>:org:<slug> resolves to https://<host>/org/<slug>/did.json
    // (decision 0005); the frontend serves that path from here.
    { method: 'GET', path: '/issuer/org/:slug/did.json', handler: 'issuer-did.organization',
      config: { auth: false, policies: [], middlewares: [] } },
  ],
}
