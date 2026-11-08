import { normalizeAchievementMetadata, normalizeSubjectMetadata, issuerProfile } from '../../../utils/ob3-metadata'
/**
 * Credential service
 */

import { getNotificationProvider } from './notification-providers'
import { channelAlerts } from './channel-alerts/index'
import { credentialsIssuedTotal } from '../../../monitoring/metrics'
import { normalizeResults } from '../../../utils/ob3-results'
import { signCredential } from '../../../utils/data-integrity'
import { assertIssuerProfile } from '../../../utils/issuer-did'

export default ({ strapi }) => ({
  /**
   * Issue a new credential
   * @param {Object} achievement - The achievement to issue
   * @param {Object} recipient - The recipient profile
   * @param {Array} evidence - Optional evidence items
   * @param {string} expirationDate - Optional expiration date for the credential
   * @param {number} [actorId] - The users-permissions user id of the caller, for the audit log
   * @param {string} [awardedDate] - When the learning was achieved, if not now
   * @param {Object} [results] - Optional { resultDescription, result } per OB 3.0 (see utils/ob3-results)
   */
  async issue(achievement, recipient, evidence = [], expirationDate = undefined, actorId = undefined, awardedDate = undefined, results = undefined, metadata = undefined) {
    try {
      // Validated before anything is created: a result a verifier cannot
      // resolve must fail the issue, not produce a half-meaningful credential.
      await assertIssuerProfile(strapi, achievement.creator?.id)
      const achievementMetadata0023 = normalizeAchievementMetadata(metadata?.achievement !== undefined ? metadata.achievement : achievement.metadata0023 ?? undefined)
      let subjectMetadata0023 = normalizeSubjectMetadata(metadata?.subject)
      if (recipient.name !== undefined) normalizeSubjectMetadata({ name: recipient.name })
      issuerProfile(strapi, 'urn:validation:issuer')
      const normalizedResults = normalizeResults(results?.resultDescription, results?.result)

      const recipientEntity = await this.findOrCreateRecipientProfile(recipient)
      if (typeof recipientEntity.email !== 'string' || !recipientEntity.email.trim()) {
        throw new Error('Recipient email is required for issuance')
      }

      // Snapshot the incoming name (or stored recipient for older callers).
      // It must not change later when the recipient edits their profile.
      subjectMetadata0023 = normalizeSubjectMetadata({ ...subjectMetadata0023,
        ...((subjectMetadata0023?.name || recipient.name || recipientEntity.name)
          ? { name: subjectMetadata0023?.name || recipient.name || recipientEntity.name } : {}) })

      // Find or create user associated with the profile
      const recipientUser = await this.findOrCreateUser(recipientEntity)
      // The holder portal checks ownership explicitly (recipient.owner), not
      // by email. A recipient profile created here has no owner yet: link it
      // to the account with the same email, which is the one the holder will
      // sign in with. Never overwrite an existing owner.
      await this.claimRecipientProfile(recipientEntity, recipientUser)

      // Generate a unique credential ID
      const credentialId = `urn:uuid:${this.generateUUID()}`

      // Prepare the credential payload for signing (excluding proof)
      const credentialPayload = {
        credentialId,
        name: achievement.name,
        description: achievement.description,
        type: ['VerifiableCredential', 'OpenBadgeCredential'],
        achievement: achievement.id,
        issuer: achievement.creator?.id,
        recipient: recipientEntity.id,
        issuanceDate: new Date(),
        revoked: false,
        publishedAt: new Date(),
        // Signed, not just serialized: awardedDate is a claim about when the
        // learning happened, so it has to be covered by the signature -
        // otherwise it could be altered afterwards and the credential would
        // still verify. Only added when present, so credentials earned and
        // issued at the same time serialize exactly as they always have.
        ...(awardedDate ? { awardedDate: new Date(awardedDate) } : {}),
        // Signed for the same reason as awardedDate: the level reached on
        // each criterion is a claim about the learner, and the rubric it
        // refers to is snapshotted here so later rubric versions cannot
        // change what an existing credential says.
        ...(normalizedResults ?? {}),
        ...(expirationDate ? { expirationDate: new Date(expirationDate) } : {})
      }
      // Sign only the complete OB3 document after allocating its status slot.

      // Reserve a slot for this credential in the issuer's revocation
      // status list (Bitstring Status List), creating the list on first use.
      const revocationListService = strapi.service('api::revocation-list.revocation-list')
      const statusList = await revocationListService.getOrCreateActiveListForIssuer(credentialPayload.issuer)
      const { index: statusListIndex, statusListId } = await revocationListService.assignNextIndex(statusList.id)

      // Create the credential
      const credential = await strapi.entityService.create('api::credential.credential', {
        data: {
          credentialId,
          name: achievement.name,
          description: achievement.description,
          type: ['VerifiableCredential', 'OpenBadgeCredential'],
          achievement: achievement.id,
          issuer: achievement.creator?.id,
          recipient: recipientEntity.id,
          issuanceDate: new Date(),
          revoked: false,
          publishedAt: new Date(),
          proof: [],
          achievementMetadata0023,
          subjectMetadata0023,
          statusList: statusListId,
          statusListIndex,
          ...(awardedDate ? { awardedDate: new Date(awardedDate) } : {}),
          ...(normalizedResults ?? {}),
          ...(expirationDate ? { expirationDate: new Date(expirationDate) } : {})
        }
      })

      // Explicitly connect the credential to the recipient's profile.
      // This ensures the bidirectional relationship is updated.
      if (recipientEntity && recipientEntity.id && credential && credential.id) {
        await strapi.entityService.update('api::profile.profile', recipientEntity.id, {
          data: {
            receivedCredentials: {
              connect: [{ id: credential.id }],
            },
            publishedAt: new Date(),
          },
        })
      }

      // Add evidence if provided
      if (evidence && evidence.length > 0) {
        for (const item of evidence) {
          if (item.name || item.description) {
            await strapi.entityService.create('api::evidence.evidence', {
              data: {
                name: item.name || 'Evidencia',
                description: item.description || '',
                // Una ruta apilable cita como evidencia la credencial de cada paso:
                // su URL de verificación, su narrativa y el género «Credencial».
                ...(typeof item.url === 'string' && /^https:\/\//.test(item.url) ? { url: item.url } : {}),
                ...(typeof item.narrative === 'string' ? { narrative: item.narrative } : {}),
                ...(typeof item.genre === 'string' ? { genre: item.genre } : {}),
                credential: credential.id,
                publishedAt: new Date(),
              }
            })
          }
        }
      }

      // Return the full credential with populated relations
      const populatedCredential = await strapi.entityService.findOne(
        'api::credential.credential',
        credential.id,
        {
          status: 'published',
          populate: [
            'achievement',
            'issuer',
            'recipient',
            'evidence',
            'proof'
          ],
        }
      )

      // Convert to Open Badge format
      const openBadgeService = strapi.service('api::credential.open-badge')
      const serializedCredential = await openBadgeService.serializeCredential(credential.id, true)
      await strapi.entityService.update('api::credential.credential', credential.id, {
        data: { signedCredential: serializedCredential, proof: [serializedCredential.proof] },
      })

      // Send notification email to recipient
      let emailSent = false
      let emailError = null

      try {
        if (recipientEntity.email) {
          // Check if a user was created for this profile
          const user = await strapi.query('plugin::users-permissions.user').findOne({
            where: { email: recipientEntity.email }
          })

          const frontendUrl = strapi.config.get('frontend.url', 'http://localhost:3000')

          const notificationProvider = getNotificationProvider(strapi)
          await notificationProvider.sendCredentialIssued({
            to: recipientEntity.email,
            achievement,
            credential,
            frontendUrl,
            user,
          })

          emailSent = true
        }
      } catch (e) {
        console.error('Failed to send notification email:', e)
        emailError = e.message
      }

      // Notify any registered webhook subscriptions. Best-effort: dispatch()
      // never throws (each delivery is individually caught/logged), so this
      // can't fail the issuance itself.
      const webhookDispatcher = strapi.service('api::webhook-subscription.dispatch')
      await webhookDispatcher.dispatch('credential.issued', {
        credentialId: credential.credentialId,
        achievementId: achievement.id,
        issuerId: credentialPayload.issuer,
        recipientId: recipientEntity.id,
      })

      // Record who issued this - see known-issues-and-dev-notes.md item 5
      // (this controller path disables the normal permission check).
      const auditLog = strapi.service('api::audit-log-entry.audit-log')
      await auditLog.record({
        action: 'credential.issue',
        entityType: 'credential',
        entityId: credential.id,
        actorId,
        metadata: { achievementId: achievement.id, recipientId: recipientEntity.id },
      })
      credentialsIssuedTotal.inc()

      // Fan out admin channel alerts (Slack/Teams/Discord) — best-effort, never throws
      const frontendUrl = strapi.config.get('custom.frontendUrl', 'http://localhost:3000')
      channelAlerts.sendCredentialIssued({
        credentialId: credential.credentialId,
        credentialUrl: `${frontendUrl}/credentials/${encodeURIComponent(credential.credentialId)}`,
        achievementName: (achievement as any).achievementType ?? (achievement as any).name ?? 'Unknown',
        recipientEmail: (recipientEntity as any).email ?? '',
      }).catch(() => { /* already logged inside channelAlerts */ })
      return {
        credential: { ...populatedCredential, proof: [serializedCredential.proof] },
        openBadge: serializedCredential,
        notification: {
          sent: emailSent,
          error: emailError
        }
      }
    } catch (error) {
      console.error('Error issuing credential:', error)
      throw error
    }
  },

  /**
   * Find or create the recipient profile for an incoming credential -
   * either an existing profile by id, an existing one by email, or a new
   * bare Recipient profile if neither exists yet. Shared by issue() and by
   * the profile data-portability service's import path.
   * @param {Object} recipient - `{ id }` or `{ email, name }`
   */
  async findOrCreateRecipientProfile(recipient) {
    let recipientEntity = null

    if (recipient.id && recipient.id !== 0) {
      recipientEntity = await strapi.entityService.findOne(
        'api::profile.profile',
        recipient.id,
        { status: 'published' }
      )
    } else if (recipient.email) {
      const existingRecipients = await strapi.entityService.findMany(
        'api::profile.profile',
        {
          filters: { email: recipient.email },
          status: 'published',
        }
      )

      if (existingRecipients && existingRecipients.length > 0) {
        recipientEntity = existingRecipients[0]
      } else {
        recipientEntity = await strapi.entityService.create('api::profile.profile', {
          data: {
            name: recipient.name,
            email: recipient.email,
            profileType: 'Recipient',
            publishedAt: new Date(),
          }
        })
      }
    }

    if (!recipientEntity) {
      throw new Error('Unable to find or create recipient profile')
    }

    return recipientEntity
  },

  /**
   * Find or create a user associated with a profile
   * @param {Object} profile - The profile to associate with a user
   */
  async claimRecipientProfile(profile, user) {
    if (!profile?.id || !user?.id || !profile.email || !user.email) return
    if (String(profile.email).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) return
    const current: any = await strapi.entityService.findOne('api::profile.profile', profile.id, { populate: ['owner'] })
    if (current?.owner?.id) return
    await strapi.entityService.update('api::profile.profile', profile.id, { data: { owner: user.id } })
  },

  async findOrCreateUser(profile) {
    try {
      if (!profile.email) {
        return null
      }

      // Check if user already exists
      const existingUser = await strapi.query('plugin::users-permissions.user').findOne({
        where: { email: profile.email },
        populate: {
          role: true,
          createdBy: true,
          updatedBy: true,
          localizations: true,
          provider: true,
          resetPasswordToken: true,
          username: true,
          email: true,
          password: true,
          locale: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true
        }
      })

      if (existingUser) {
        return existingUser
      }

      // Get the authenticated role
      const authenticatedRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authenticatedRole) {
        console.error('Authenticated role not found')
        return null
      }

      // Generate a random password
      const randomPassword = this.generateRandomPassword()

      // Create a new user with a random password
      //
      // The provider must match the one the recipient will actually sign in
      // with. users-permissions' connect() looks a user up by email *and*
      // provider, and refuses with "Email is already taken." when the email
      // exists under a different one - so a recipient created as 'local'
      // would be permanently locked out of SSO. When Keycloak is configured
      // (see bootstrap/keycloak-provider.ts) recipients are institutional
      // identities, not local accounts.
      const provider = process.env.KEYCLOAK_PUBLIC_URL ? 'keycloak' : 'local'

      const newUser = await strapi.service('plugin::users-permissions.user').add({
        username: profile.email.split('@')[0] + Date.now(),
        email: profile.email,
        password: randomPassword,
        role: authenticatedRole.id,
        confirmed: true,
        provider
      })

      return newUser
    } catch (error) {
      console.error('Error finding or creating user:', error)
      return null
    }
  },

  /**
   * Generate a random password
   * @returns {string} A random password
   */
  generateRandomPassword() {
    const length = 12
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()'
    let password = ''
    
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length)
      password += charset[randomIndex]
    }
    
    return password
  },

  /**
   * Get or create a default system issuer profile
   */
  async getDefaultIssuerId() {
    try {
      // Try to find a system issuer
      const existingIssuers = await strapi.entityService.findMany('api::profile.profile', {
        filters: { name: 'System Issuer' },
        status: 'published',
      })
      
      if (existingIssuers && existingIssuers.length > 0) {
        return existingIssuers[0].id
      }
      
      // Create a default system issuer
      const systemIssuer = await strapi.entityService.create('api::profile.profile', {
        data: {
          name: 'System Issuer',
          profileType: 'Issuer',
          publishedAt: new Date(),
        }
      })
      
      return systemIssuer.id
    } catch (error) {
      console.error('Error getting default issuer:', error)
      return null
    }
  },

  /**
   * Generate cryptographic proof for a credential, signed with the
   * issuer's own keypair (generated on first use - see
   * api::profile.issuer-keys). Throws rather than falling back to a fake
   * proof: an unsigned "signed" credential is worse than a failed issuance.
   * @param {string} issuerId - The ID of the issuer profile
   * @param {Object} credentialPayload - The credential payload
   */
  async generateProof(issuerId, credentialPayload) {
    return (await signCredential(strapi, issuerId, credentialPayload)).proof
  },

  // CLR envelopes retain their historical format; their embedded credentials
  // are immutable and may carry either legacy JWS or Data Integrity proofs.
  async generateLegacyProof(issuerId, credentialPayload) {
    const baseUrl = strapi.config.get('server.url', 'http://localhost:1337')
    const payload = { ...credentialPayload }
    delete payload.proof

    const issuerKeys = strapi.service('api::profile.issuer-keys')
    const { privateKey, keyId } = await issuerKeys.getOrCreateKeyPair(issuerId)

    const { SignJWT } = await import('jose')
    const jws = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'EdDSA' })
      .sign(privateKey)

    return {
      type: "Ed25519Signature2020",
      created: new Date().toISOString(),
      // Points at the exact key that signed this credential (not just "the
      // issuer's keys"), so a later key rotation never breaks a standards-
      // compliant external verifier resolving this URL. See
      // profile.getPublicKeyById / routes/profile-keys.ts.
      verificationMethod: `${baseUrl}/api/profiles/${issuerId}/keys/${keyId}`,
      proofPurpose: "assertionMethod",
      jws
    }
  },

  /**
   * Generate a UUID v4
   * @returns {string} A UUID v4 string
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  },
})
