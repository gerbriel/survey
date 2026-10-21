import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { asJson, call, id, jsonObject } from './rpc'

/**
 * Contact functions (migrations 0007 and 0014, doc 04 sections 1 and 2).
 * search_contacts and contact_duplicate_candidates are SECURITY INVOKER, so
 * RLS applies to the caller. Writes are editor and above.
 */
export type Contact = Tables<'contacts'>

export const setContactCustomInput = z.object({ contactId: id, values: jsonObject })

/** Merges values into contacts.custom (null removes a key). Returns the new custom object. */
export function setContactCustom(client: UserClient, input: z.input<typeof setContactCustomInput>) {
  return call(
    setContactCustomInput,
    input,
    (v) => client.rpc('set_contact_custom', { p_contact_id: v.contactId, p_values: asJson(v.values) }),
    (d): Record<string, Json> => (d ?? {}) as Record<string, Json>,
  )
}

const customFilter = z.object({
  key: z.string(),
  op: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_not_set']),
  value: z.unknown().optional(),
})

/** Filter keys read by SQL search_contacts. All optional, combined with AND. */
export const contactFilters = z.looseObject({
  lead_status: z.array(z.enum(['new', 'contacted', 'qualified', 'customer', 'lost'])).optional(),
  owner: z.object({ ids: z.array(id).optional(), unassigned: z.boolean().optional(), me: z.boolean().optional() }).optional(),
  tags: z.object({ mode: z.enum(['any', 'all', 'none']).optional(), values: z.array(z.string()) }).optional(),
  responded: z
    .array(z.object({ survey_id: id, has: z.boolean().optional(), complete_only: z.boolean().optional() }))
    .optional(),
  custom: z.array(customFilter).optional(),
  q: z.string().optional(),
  source: z.string().optional(),
  follow_up: z.enum(['overdue', 'due', 'this_week', 'unset']).optional(),
  created_from: z.string().optional(),
  created_to: z.string().optional(),
  last_response_from: z.string().optional(),
  last_response_to: z.string().optional(),
})

export type ContactFilters = z.input<typeof contactFilters>

export const searchContactsInput = z.object({
  workspaceId: id,
  filters: contactFilters.default({}),
  /** Keyset cursor from the last row of the previous page. */
  cursor: z.object({ updated_at: z.string(), id }).nullable().default(null),
  limit: z.number().int().min(1).max(200).default(50),
})

export function searchContacts(client: UserClient, input: z.input<typeof searchContactsInput>) {
  return call(
    searchContactsInput,
    input,
    (v) =>
      client.rpc('search_contacts', {
        p_workspace_id: v.workspaceId,
        p_filters: asJson(v.filters),
        ...(v.cursor ? { p_cursor: asJson(v.cursor) } : {}),
        p_limit: v.limit,
      }),
    (rows): Contact[] => (rows ?? []) as Contact[],
  )
}

export type DuplicateCandidate = {
  contact_a: string
  contact_b: string
  reason: 'same_phone' | 'same_name_company' | 'email_variant' | 'alt_email' | 'similar_email'
}

export const workspaceInput = z.object({ workspaceId: id })

export function contactDuplicateCandidates(client: UserClient, input: z.input<typeof workspaceInput>) {
  return call(
    workspaceInput,
    input,
    (v) => client.rpc('contact_duplicate_candidates', { p_workspace_id: v.workspaceId }),
    (rows): DuplicateCandidate[] => (rows ?? []) as DuplicateCandidate[],
  )
}

export const importRow = z.looseObject({
  email: z.string(),
  phone: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  lead_status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owner_email: z.string().optional(),
  custom: jsonObject.optional(),
})

export const importChunkInput = z.object({ importId: id, rows: z.array(importRow).max(500) })

export type ImportChunkResult = {
  created: number
  updated: number
  skipped: number
  invalid: number
  errors: { index: number; error: string }[]
  tokens: { index: number; contact_id: string; token: string }[]
}

/** One chunk of at most 500 rows of a contact_imports job. */
export function importContactsChunk(client: UserClient, input: z.input<typeof importChunkInput>) {
  return call(
    importChunkInput,
    input,
    (v) => client.rpc('import_contacts_chunk', { p_import_id: v.importId, p_rows: asJson(v.rows) }),
    (d): ImportChunkResult => d as unknown as ImportChunkResult,
  )
}

export const mergeContactsInput = z.object({
  survivorId: id,
  /** 1 to 4 losers, so 2 to 5 contacts in total. */
  mergedIds: z.array(id).min(1).max(4),
  /** {"<field>": "<contact id to take it from>"}, "custom.<key>" for custom fields. */
  fieldChoices: z.record(z.string(), id).default({}),
})

export function mergeContacts(client: UserClient, input: z.input<typeof mergeContactsInput>) {
  return call(
    mergeContactsInput,
    input,
    (v) =>
      client.rpc('merge_contacts', {
        p_survivor: v.survivorId,
        p_merged: v.mergedIds,
        p_field_choices: asJson(v.fieldChoices),
      }),
    () => undefined,
  )
}
