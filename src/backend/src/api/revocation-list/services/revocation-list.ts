/**
 * revocation-list service
 */

import { factories } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import crypto from 'crypto'
import { issuerDidFor } from '../../../utils/issuer-did'
import { signCredential } from '../../../utils/data-integrity'
const { ApplicationError } = errors

// @digitalbazaar/vc-bitstring-status-list is ESM-only; this backend compiles
// to CommonJS, so it's loaded with a dynamic import, same as this codebase
// already does for `jose` in credential.ts's generateProof().
const bitstringStatusList = () => import('@digitalbazaar/vc-bitstring-status-list')

// Size of a new status list, in bits. 131,072 (16 KiB uncompressed) is a
// common default across Bitstring Status List implementations -- large
// enough that a given index doesn't single out its holder among too small
// a cohort, small enough that it gzips down to a few dozen bytes when
// mostly unset. See https://www.w3.org/TR/vc-bitstring-status-list/.
const STATUS_LIST_LENGTH = 131072

interface RevocationList {
  id: any
  issuer: any
  statusListCredential: string
  statusPurpose: string
  encodedList: string
  lastUpdated: Date
}

// Exported separately (not just inline in createCoreService below) so unit
// tests can call it directly against a lightweight fake `strapi` without
// going through Strapi's core service factory, which needs a real app
// instance (strapi.contentType(), etc.) to construct the base CRUD methods.
export const revocationListExtension = ({ strapi }: { strapi: any }) => ({
  async serializeCredential(statusList: any) {
    if (!statusList.issuer?.id) throw new Error('Status list issuer is missing')
    const baseUrl = strapi.config.get('server.url', 'http://localhost:1337')
    const { createCredential, decodeList, VC_BSL_VC_V2_CONTEXT } = await bitstringStatusList()
    const credential = await createCredential({
      id: `${baseUrl}/api/revocation-lists/${statusList.id}`,
      list: await decodeList({ encodedList: statusList.encodedList }),
      statusPurpose: statusList.statusPurpose || 'revocation', context: VC_BSL_VC_V2_CONTEXT,
    })
    credential.issuer = await issuerDidFor(strapi, statusList.issuer.id)
    credential.validFrom = new Date(statusList.lastUpdated).toISOString()
    return signCredential(strapi, statusList.issuer.id, credential)
  },

  /**
   * Check if a credential has been revoked in any revocation list
   */
  async checkCredentialStatus(credentialId: string) {
    try {
      // Find the credential to get the issuer
      const credential = await strapi.db.query('api::credential.credential').findOne({
        where: { credentialId },
        populate: ['issuer']
      })
      
      if (!credential) {
        throw new ApplicationError('Credential not found')
      }
      
      // If the credential is directly marked as revoked
      if (credential.revoked) {
        return {
          revoked: true,
          reason: credential.revocationReason || 'Credential has been revoked'
        }
      }
      
      return { revoked: false }
    } catch (error) {
      console.error('Error checking credential status:', error)
      throw new ApplicationError(`Error checking credential status: ${error.message}`)
    }
  },
  
  /**
   * Check if a credential is revoked in a specific status list.
   *
   * encodedList is a real Bitstring Status List (gzip+base64url, multibase
   * "u"-prefixed) -- the same encoding a `BitstringStatusListCredential`
   * exposes externally, decoded here to read a single bit.
   */
  async checkStatusInList(statusList: RevocationList, statusListIndex: number) {
    try {
      if (!statusList.encodedList) return false

      const { decodeList } = await bitstringStatusList()
      const list = await decodeList({ encodedList: statusList.encodedList })
      return list.getStatus(statusListIndex)
    } catch (error) {
      console.error('Error checking status in list:', error)
      throw new ApplicationError('Cannot verify status list')
    }
  },

  /**
   * Create a new status list credential for an issuer
   */
  async createStatusListCredential(issuerId: number | string, purpose = 'revocation') {
    try {
      // Find the issuer
      const issuer = await strapi.entityService.findOne('api::profile.profile', issuerId)

      if (!issuer) {
        throw new ApplicationError('Issuer not found')
      }

      // Create a unique ID for the status list credential
      const statusListId = `urn:uuid:${crypto.randomUUID()}`

      // A fresh, all-unset Bitstring Status List (every credential slotted
      // into it starts out not-revoked).
      const { createList } = await bitstringStatusList()
      const list = await createList({ length: STATUS_LIST_LENGTH })
      const encodedList = await list.encode()

      const created = await strapi.entityService.create('api::revocation-list.revocation-list', {
        data: {
          issuer: issuerId,
          statusListCredential: statusListId,
          statusPurpose: purpose,
          encodedList,
          nextIndex: 0,
          lastUpdated: new Date(),
          publishedAt: new Date()
        }
      })

      // entityService.create() with publishedAt set can return the draft
      // row's id even though a published sibling (same documentId) also
      // exists -- re-fetch the published version explicitly so callers get
      // an id that other already-published entities can safely relate to.
      const [published] = await strapi.entityService.findMany('api::revocation-list.revocation-list', {
        filters: { documentId: created.documentId },
        status: 'published',
      })

      return published || created
    } catch (error) {
      console.error('Error creating status list credential:', error)
      throw new ApplicationError(`Error creating status list credential: ${error.message}`)
    }
  },

  /**
   * Find the issuer's active revocation list, creating one if this is
   * their first credential.
   */
  async getOrCreateActiveListForIssuer(issuerId: number | string) {
    const existing = await strapi.entityService.findMany('api::revocation-list.revocation-list', {
      filters: { issuer: { id: issuerId }, statusPurpose: 'revocation' },
      status: 'published',
    })
    if (existing && existing.length > 0) return existing[0]
    return this.createStatusListCredential(issuerId)
  },

  /**
   * Reserve the next available index in a status list for a new credential.
   */
  async assignNextIndex(statusListId: number | string) {
    const statusList = await strapi.entityService.findOne('api::revocation-list.revocation-list', statusListId)
    if (!statusList) {
      throw new ApplicationError('Status list not found')
    }

    const index = statusList.nextIndex ?? 0
    const updated = await strapi.entityService.update('api::revocation-list.revocation-list', statusListId, {
      data: { nextIndex: index + 1 },
    })

    // entityService.update() on a Draft & Publish content type does not
    // necessarily mutate statusListId in place -- Strapi 5 can return a
    // different id for the (still published) row. Callers that persist a
    // relation to this status list (e.g. a newly issued credential) must
    // use the id from this update's result, or the relation will point at
    // a row that no longer resolves.
    return { index, statusListId: updated?.id ?? statusListId }
  },
  
  /**
   * Update a status list to revoke a credential
   */
  async revokeCredentialInStatusList(statusListId: number | string, statusListIndex: number) {
    try {
      // Find the status list
      const statusList = await strapi.entityService.findOne('api::revocation-list.revocation-list', statusListId)

      if (!statusList) {
        throw new ApplicationError('Status list not found')
      }

      const { createList, decodeList } = await bitstringStatusList()
      const list = statusList.encodedList
        ? await decodeList({ encodedList: statusList.encodedList })
        : await createList({ length: STATUS_LIST_LENGTH })
      list.setStatus(statusListIndex, true)

      // Update the status list
      await strapi.entityService.update('api::revocation-list.revocation-list', statusListId, {
        data: {
          encodedList: await list.encode(),
          lastUpdated: new Date()
        }
      })

      return true
    } catch (error) {
      console.error('Error revoking credential in status list:', error)
      throw new ApplicationError(`Error revoking credential in status list: ${error.message}`)
    }
  }
})

export default factories.createCoreService('api::revocation-list.revocation-list', revocationListExtension)
