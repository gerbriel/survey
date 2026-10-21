import { z } from 'zod'
import type { Json } from '@/types/db-helpers'
import type { AdminClient, UserClient } from '@/lib/supabase/types'
import { call, id, type StorageDeletion } from './rpc'

/**
 * Respondent erasure, GDPR export and retention (migrations 0014 and 0015,
 * doc 04 section 7). Erase is admin; export is editor and above; retention is
 * service role from Vercel Cron.
 */

export const eraseInput = z.object({ contactId: id, mode: z.enum(['hard', 'anonymize']) })

/**
 * Accepts a merged alias id too. Returns the Storage objects it queued; the
 * route deletes them at once and calls completeStorageDeletions.
 */
export function eraseRespondent(client: UserClient, input: z.input<typeof eraseInput>) {
  return call(
    eraseInput,
    input,
    (v) => client.rpc('erase_respondent', { p_contact_id: v.contactId, p_mode: v.mode }),
    (rows): StorageDeletion[] => (rows ?? []) as StorageDeletion[],
  )
}

export const contactIdInput = z.object({ contactId: id })

/** Doc 04 GDPR JSON. Files are listed by storage path; the route signs download URLs. */
export function exportRespondentData(client: UserClient, input: z.input<typeof contactIdInput>) {
  return call(
    contactIdInput,
    input,
    (v) => client.rpc('export_respondent_data', { p_contact_id: v.contactId }),
    (d): Json => d as Json,
  )
}

export const retentionInput = z.object({ workspaceId: id, limit: z.number().int().min(1).max(10000).default(1000) })

/** Deletes responses older than the workspace retention_days, returns that workspace's undone deletions. */
export function retentionBatch(client: AdminClient, input: z.input<typeof retentionInput>) {
  return call(
    retentionInput,
    input,
    (v) => client.rpc('retention_batch', { p_workspace_id: v.workspaceId, p_limit: v.limit }),
    (rows): StorageDeletion[] => (rows ?? []) as StorageDeletion[],
  )
}
