/**
 * Profile routes for public key exposure
 */

export default {
  routes: [
    // GET /profiles/:id/keys was removed (decision 0005): it built the
    // controller DID from the request's Host header. Keys are published in
    // the DID documents (/.well-known/did.json, /org/<slug>/did.json).
    // Resolve one specific historical key by id -- what a freshly-issued
    // credential's proof.verificationMethod now points to, so a later key
    // rotation never breaks a standards-compliant external verifier. Works
    // for both the current active key and any retired one.
    {
      method: 'GET',
      path: '/profiles/:id/keys/:keyId',
      handler: 'profile.getPublicKeyById',
      config: {
        auth: false,
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/profiles/:id/.well-known/jwks.json',
      handler: 'profile.getJWKS',
      config: {
        auth: false,
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/profiles/:id/issuer',
      handler: 'profile.getIssuer',
      config: {
        auth: false,
        middlewares: [],
      },
    },
    // Retires the profile's current signing key and activates a new one.
    // Owner-only: for scheduled rotation or incident response to a
    // suspected key compromise.
    {
      method: 'POST',
      path: '/profiles/:id/rotate-key',
      handler: 'profile.rotateSigningKey',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: [],
      },
    },
  ],
} 