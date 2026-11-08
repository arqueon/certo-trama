/**
 * profile controller
 */

import { factories } from '@strapi/strapi'
import { errors } from '@strapi/utils'
const { ApplicationError } = errors

// Define interface for profile
interface ProfileWithCredentials {
  id: any
  name: string
  email?: string
  issuedCredentials?: any[]
  receivedCredentials?: any[]
}

// Define interface for profile with public keys
interface ProfileWithPublicKeys {
  id: any
  name: string
  email?: string
  url?: string
  did?: string
  publicKey?: Array<{
    id: string
    type: string
    publicKeyJwk?: any
  }>
}

/**
 * Whether the caller may list this profile's credentials: they own it, or it
 * is their own recipient profile (same email). Stricter than
 * userOwnsProfile(), which treats unowned profiles as open - recipient
 * profiles are unowned, so that would let anyone list anyone's credentials.
 */
async function callerIsProfile(strapi: any, ctx: any, profileId: string | number): Promise<boolean | null> {
  const user = ctx.state.user
  if (!user) return false
  const profile: any = await strapi.entityService.findOne('api::profile.profile', profileId, { populate: ['owner'] })
  if (!profile) return null
  if (profile.owner?.id === user.id) return true
  return Boolean(profile.email && user.email && profile.email.toLowerCase() === user.email.toLowerCase())
}

export default factories.createCoreController('api::profile.profile', ({ strapi }) => ({
  // Custom controller methods for profile

  /**
   * Persist ownership for newly-created profiles. Existing ownerless profiles
   * remain readable for backward compatibility and are claimed on first edit.
   */
  async create(ctx) {
    // The organization DID slug is set only by the platform (admin panel or
    // database), never through the REST API (decision 0005).
    if (ctx.request.body?.data) delete ctx.request.body.data.didSlug;
    if (ctx.state.user) {
      ctx.request.body ??= {};
      ctx.request.body.data ??= {};
      ctx.request.body.data.owner = ctx.state.user.id;
    }

    return super.create(ctx);
  },

  /** Prevent one authenticated user from editing another user's profile. */
  async update(ctx) {
    if (ctx.request.body?.data) delete ctx.request.body.data.didSlug;
    if (ctx.state.user) {
      const profile: any = await (strapi.entityService as any).findOne('api::profile.profile', ctx.params.id, {
        populate: { owner: { fields: ['id'] } },
      });

      if (!profile) return ctx.notFound('Profile not found');
      if (profile.owner && profile.owner.id !== ctx.state.user.id) {
        return ctx.forbidden('You cannot update this profile');
      }

      ctx.request.body ??= {};
      ctx.request.body.data ??= {};
      ctx.request.body.data.owner = ctx.state.user.id;
    }

    return super.update(ctx);
  },

  /** Prevent deleting another user's profile or an unowned legacy profile. */
  async delete(ctx) {
    if (ctx.state.user) {
      const profile: any = await (strapi.entityService as any).findOne('api::profile.profile', ctx.params.id, {
        populate: { owner: { fields: ['id'] } },
      });

      if (!profile) return ctx.notFound('Profile not found');
      if (!profile.owner || profile.owner.id !== ctx.state.user.id) {
        return ctx.forbidden('You cannot delete this profile');
      }
    }

    return super.delete(ctx);
  },
  
  /**
   * Get the current user's profile
   */
  async me(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const userEmail = ctx.state.user.email;
      
      // Find profile by email
      const profiles = await strapi.entityService.findMany('api::profile.profile', {
        filters: { email: userEmail },
        status: 'published',
        limit: 1
      });
      
      // Return the first profile that matches
      if (profiles && profiles.length > 0) {
        return { data: profiles[0] };
      }

      return ctx.notFound('Profile not found for the current user');
    } catch (err) {
      console.error('Error fetching current user profile:', err);
      return ctx.badRequest('Error fetching profile', { error: err });
    }
  },

  /**
   * Export everything associated with the current user's own profile:
   * achievements it created, credentials it issued or received, and their
   * evidence. See services/data-portability.ts.
   */
  async exportMyData(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const profiles = await strapi.entityService.findMany('api::profile.profile', {
        filters: { owner: ctx.state.user.id },
        status: 'published',
        limit: 1,
      });

      if (!profiles || profiles.length === 0) {
        return ctx.notFound('Profile not found for the current user');
      }

      const dataPortability = strapi.service('api::profile.data-portability');
      return await dataPortability.exportProfileData(profiles[0]);
    } catch (err) {
      console.error('Error exporting profile data:', err);
      return ctx.badRequest('Error exporting profile data', { error: err });
    }
  },

  /**
   * GDPR right-to-erasure: delete the current user's profile and all
   * associated data per the cascade policy in services/right-to-erasure.ts.
   * Requires an explicit `confirm: true` in the request body to prevent
   * accidental deletion.
   */
  async deleteMyData(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const { confirm } = ctx.request.body || {};
      if (confirm !== true) {
        return ctx.badRequest('Deletion requires explicit confirmation: { confirm: true }');
      }

      const profiles = await strapi.entityService.findMany('api::profile.profile', {
        filters: { email: ctx.state.user.email },
        status: 'published',
        limit: 1,
      });

      if (!profiles || profiles.length === 0) {
        return ctx.notFound('Profile not found for the current user');
      }

      const rightToErasure = strapi.service('api::profile.right-to-erasure');
      const summary = await rightToErasure.deleteProfileData(profiles[0], ctx.state.user);

      const auditLog = strapi.service('api::audit-log-entry.audit-log')
      await auditLog.record({
        action: 'profile.delete-data',
        entityType: 'profile',
        entityId: profiles[0].id,
        actorId: ctx.state.user?.id,
        metadata: { ...summary },
      })

      return { success: true, summary };
    } catch (err) {
      console.error('Error deleting profile data:', err);
      return ctx.badRequest('Error deleting profile data', { error: err });
    }
  },

  /**
   * Restores achievements/credentials the current user's profile previously
   * exported via exportMyData - never someone else's data, never
   * credentials merely *received* by this profile. See
   * services/data-portability.ts.
   */
  async importMyData(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const profiles = await strapi.entityService.findMany('api::profile.profile', {
        filters: { email: ctx.state.user.email },
        status: 'published',
        limit: 1,
      });

      if (!profiles || profiles.length === 0) {
        return ctx.notFound('Profile not found for the current user');
      }

      const dataPortability = strapi.service('api::profile.data-portability');
      const isService = ctx.state.user.role?.name === 'Servicio de emision';
      return await dataPortability.importProfileData(profiles[0], ctx.request.body || {}, { restoreCredentials: isService });
    } catch (err) {
      console.error('Error importing profile data:', err);
      return ctx.badRequest('Error importing profile data', { error: err });
    }
  },

  /**
   * Per-issuer analytics: real credential/achievement counts for the
   * current user's profile, replacing the hardcoded placeholder values
   * the frontend was previously showing. Served at
   * GET /api/dashboard/stats to match the existing API-client call.
   */
  async dashboardStats(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in');
      }

      const profiles = await strapi.entityService.findMany('api::profile.profile', {
        filters: { email: ctx.state.user.email },
        status: 'published',
        limit: 1,
      });

      if (!profiles || profiles.length === 0) {
        return ctx.notFound('Profile not found for the current user');
      }

      const dashboard = strapi.service('api::profile.dashboard');
      const stats = await dashboard.getStats(ctx.state.user.id, profiles[0].id);
      return { data: stats };
    } catch (err) {
      strapi.log.error('[dashboardStats] Error fetching stats', { error: (err as Error).message });
      return ctx.badRequest('Error fetching dashboard stats', { error: (err as Error).message });
    }
  },

  async findIssuedCredentials(ctx) {
    try {
      const { id } = ctx.params
      const allowed = await callerIsProfile(strapi, ctx, id)
      if (allowed === null) return ctx.notFound('Profile not found')
      if (!allowed) return ctx.forbidden('You can only list credentials of your own profile')
      
      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        status: 'published',
        populate: {
          issuedCredentials: {
            populate: {
              achievement: {
                populate: ['image']
              },
              recipient: true
            }
          }
        }
      }) as ProfileWithCredentials
      
      if (!profile) {
        return ctx.notFound('Profile not found')
      }
      
      return { data: profile.issuedCredentials || [] }
    } catch (err) {
      ctx.badRequest('Error fetching issued credentials', { error: err })
    }
  },
  
  async findReceivedCredentials(ctx) {
    try {
      const { id } = ctx.params
      const allowed = await callerIsProfile(strapi, ctx, id)
      if (allowed === null) return ctx.notFound('Profile not found')
      if (!allowed) return ctx.forbidden('You can only list credentials of your own profile')
      
      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        status: 'published',
        populate: {
          receivedCredentials: {
            populate: {
              achievement: {
                populate: ['image']
              },
              issuer: true
            }
          }
        }
      }) as ProfileWithCredentials
      
      if (!profile) {
        return ctx.notFound('Profile not found')
      }
      
      strapi.log.debug(`[profile.findReceivedCredentials] Found ${profile.receivedCredentials?.length || 0} credentials for profile ${id}`)

      return { data: profile.receivedCredentials || [] }
    } catch (err) {
      ctx.badRequest('Error fetching received credentials', { error: err })
    }
  },

  /**
   * Get all public keys for a profile
   */
  async getPublicKeys(ctx) {
    try {
      const { id } = ctx.params

      // Find the profile with its public keys
      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        status: 'published',
        populate: ['publicKey']
      }) as ProfileWithPublicKeys

      if (!profile) {
        return ctx.notFound('Profile not found')
      }

      // Format the keys according to Open Badges 3.0 spec
      const keys = (profile.publicKey || []).map(key => ({
        id: key.id,
        type: key.type || 'Ed25519VerificationKey2020',
        controller: profile.did || `did:web:${ctx.request.header.host}:profiles:${id}`,
        publicKeyJwk: key.publicKeyJwk
      }))

      return keys[0];
    } catch (err) {
      console.error('Error fetching public keys:', err)
      return ctx.internalServerError('Error fetching public keys')
    }
  },

  /**
   * Resolve one specific historical signing key by id -- active or
   * retired. This is what a credential's proof.verificationMethod points
   * to once it was signed under the key-rotation scheme, so verifying an
   * old credential keeps working after the issuer rotates its key. Never
   * returns private key material -- issuer-key has no REST routes of its
   * own by design, this reads it server-side and returns only the public
   * half.
   */
  async getPublicKeyById(ctx) {
    try {
      const { id, keyId } = ctx.params

      const record = await strapi.db.query('api::issuer-key.issuer-key').findOne({
        where: { id: keyId, profile: id },
      })

      if (!record) {
        return ctx.notFound('Signing key not found for this profile')
      }

      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        fields: ['did'],
      }) as { did?: string } | null

      const baseUrl = strapi.config.get('server.url', 'http://localhost:1337')

      return {
        id: record.id,
        type: 'Ed25519VerificationKey2020',
        controller: profile?.did || `${baseUrl}/api/profiles/${id}/issuer`,
        publicKeyJwk: record.publicKeyJwk,
        status: record.status,
      }
    } catch (err) {
      console.error('Error fetching signing key:', err)
      return ctx.internalServerError('Error fetching signing key')
    }
  },

  /**
   * Retires the profile's current active signing key (its public half is
   * kept forever so already-issued credentials keep verifying; its
   * private key is wiped) and activates a brand-new one. Restricted to
   * the profile's owner. Use for a scheduled rotation or in response to a
   * suspected key compromise; pass { reason } in the body to record why.
   */
  async rotateSigningKey(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('Authentication required')
    }

    const { id } = ctx.params
    const multiTenancy = strapi.service('api::profile.multi-tenancy')
    const owns = await multiTenancy.userOwnsProfile(ctx.state.user.id, parseInt(id, 10))
    if (!owns) {
      return ctx.forbidden('You do not own this issuer profile')
    }

    try {
      const reason = typeof ctx.request.body?.reason === 'string' ? ctx.request.body.reason : undefined
      const issuerKeys = strapi.service('api::profile.issuer-keys')
      const { keyId, publicKeyJwk } = await issuerKeys.rotateKeyPair(id, reason)

      return {
        rotated: true,
        newKeyId: keyId,
        publicKeyJwk,
        verificationMethod: `${strapi.config.get('server.url', 'http://localhost:1337')}/api/profiles/${id}/keys/${keyId}`,
      }
    } catch (err) {
      console.error('Error rotating signing key:', err)
      return ctx.internalServerError('Error rotating signing key')
    }
  },

  /**
   * Get public keys in JWKS format
   */
  async getJWKS(ctx) {
    try {
      const { id } = ctx.params

      // Find the profile with its public keys
      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        status: 'published',
        populate: ['publicKey']
      }) as ProfileWithPublicKeys

      if (!profile) {
        return ctx.notFound('Profile not found')
      }

      // Format the keys in JWKS format
      const keys = (profile.publicKey || [])
        .filter(key => key.publicKeyJwk)
        .map(key => ({
          ...key.publicKeyJwk,
          kid: key.id || `${profile.id}-${key.type}`,
          use: 'sig',
          alg: key.type === 'Ed25519VerificationKey2020' ? 'EdDSA' : 'ES256K'
        }))

      return {
        keys
      }
    } catch (err) {
      console.error('Error fetching JWKS:', err)
      return ctx.internalServerError('Error fetching JWKS')
    }
  },

  /**
   * Multi-tenancy: Override find to only return profiles owned by the current user
   * Authenticated users can only see their own profiles
   */
  async find(ctx) {
    try {
      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in to list profiles');
      }

      const multiTenancy = strapi.service('api::profile.multi-tenancy');
      const profiles = await multiTenancy.getUserProfiles(ctx.state.user.id);
      
      return { data: profiles };
    } catch (err) {
      strapi.log.error('[profile.find] Multi-tenancy error:', { error: (err as Error).message });
      return ctx.internalServerError('Error fetching profiles');
    }
  },

  /**
   * Multi-tenancy: Override findOne to enforce ownership
   * Users can only access profiles they own
   */
  async findOne(ctx) {
    try {
      const { id } = ctx.params;

      if (!ctx.state.user) {
        return ctx.unauthorized('You must be logged in to view profiles');
      }

      const profile = await strapi.entityService.findOne('api::profile.profile', id, {
        populate: ['publicKey']
      });

      if (!profile) {
        return ctx.notFound('Profile not found');
      }

      // Check ownership
      const multiTenancy = strapi.service('api::profile.multi-tenancy');
      const ownsProfile = await multiTenancy.userOwnsProfile(ctx.state.user.id, id);

      if (!ownsProfile) {
        return ctx.forbidden('You do not have access to this profile');
      }

      return { data: profile };
    } catch (err) {
      strapi.log.error('[profile.findOne] Multi-tenancy error:', { error: (err as Error).message });
      return ctx.internalServerError('Error fetching profile');
    }
  },

  async getIssuer(ctx) {
    const { id } = ctx.params
    const profile = await strapi.entityService.findOne('api::profile.profile', id, {
      status: 'published',
      populate: ['publicKey']
    }) as ProfileWithPublicKeys

    return profile
  },
})) 