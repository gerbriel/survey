import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { ok, type DbResult } from './errors'
import { asJson, asJsonObject, call, chunks, id, jsonObject } from './rpc'

/**
 * Contact functions (migrations 0007 and 0014, doc 04 sections 1 and 2).
 * search_contacts and contact_duplicate_candidates are SECURITY INVOKER, so
 * RLS applies to the caller. Writes are editor and above.
 */
export type Contact = Tables<'contacts'>

/** Same values as the contacts.lead_status check constraint. */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

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
  lead_status: z.array(z.enum(LEAD_STATUSES)).optional(),
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

export const importIdSummaryInput = z.object({
  importId: id,
  summary: z
    .object({
      status: z.enum(['done', 'failed']).default('done'),
      created: z.number().int().min(0).optional(),
      updated: z.number().int().min(0).optional(),
      skipped: z.number().int().min(0).optional(),
      invalid: z.number().int().min(0).optional(),
      error: z.string().max(500).optional(),
    })
    .default({ status: 'done' }),
})

/**
 * Closes a contact import (finish_import, migration 0018): sets status and
 * finished_at, and replaces any counts given. Raises import_finished twice.
 */
export function finishImport(client: UserClient, input: z.input<typeof importIdSummaryInput>) {
  return call(
    importIdSummaryInput,
    input,
    (v) => client.rpc('finish_import', { p_import_id: v.importId, p_summary: asJson(v.summary) }),
    () => undefined,
  )
}

// ---------------------------------------------------------------------------
// CRM table queries under RLS (doc 04 sections 1 and 2): contact reads and
// edits, notes, field defs, views, tokens, dismissals, imports.
// ---------------------------------------------------------------------------

const contactIdInput = z.object({ contactId: id })
const workspaceIdInput = workspaceInput

export type ContactNote = Tables<'contact_notes'>
export type FieldDef = Tables<'contact_field_defs'>
export type ContactView = Tables<'contact_views'>
export type RespondentToken = Tables<'respondent_tokens'>


export function getContact(client: UserClient, input: z.input<typeof contactIdInput>) {
  return call(
    contactIdInput,
    input,
    (v) => client.from('contacts').select('*').eq('id', v.contactId).maybeSingle(),
    (row): Contact | null => row ?? null,
  )
}

export const listByIdsInput = z.object({ workspaceId: id, ids: z.array(id).max(500) })
export function listContactsByIds(client: UserClient, input: z.input<typeof listByIdsInput>) {
  return call(
    listByIdsInput,
    input,
    (v) => client.from('contacts').select('*').eq('workspace_id', v.workspaceId).in('id', v.ids),
    (rows): Contact[] => rows ?? [],
  )
}

export const listByEmailsInput = z.object({ workspaceId: id, emails: z.array(z.string()).max(500) })
/** Live contacts by normalized email. */
export function listContactsByEmails(client: UserClient, input: z.input<typeof listByEmailsInput>) {
  return call(
    listByEmailsInput,
    input,
    (v) =>
      client
        .from('contacts')
        .select('*')
        .eq('workspace_id', v.workspaceId)
        .eq('status', 'active')
        .is('merged_into', null)
        .in('email', v.emails),
    (rows): Contact[] => rows ?? [],
  )
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s === '' ? null : s))

export const contactPatch = z
  .object({
    email: nullableText(320),
    phone: nullableText(32),
    first_name: nullableText(200),
    last_name: nullableText(200),
    company: nullableText(200),
    lead_status: z.enum(LEAD_STATUSES),
    owner_id: id.nullable(),
    follow_up_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    follow_up_note: nullableText(2000),
    tags: z.array(z.string().max(40)).max(200),
  })
  .partial()
export type ContactPatch = z.input<typeof contactPatch>

export const updateContactInput = z.object({ contactId: id, patch: contactPatch })
/** Editor and above (RLS). The guard trigger normalizes email and tags. */
export function updateContact(client: UserClient, input: z.input<typeof updateContactInput>) {
  return call(
    updateContactInput,
    input,
    (v) => client.from('contacts').update(v.patch).eq('id', v.contactId).select('*').single(),
    (row): Contact => row!,
  )
}

export const createContactInput = z.object({
  workspaceId: id,
  email: z.string().trim().toLowerCase().max(320).nullable(),
  first_name: nullableText(200).optional(),
  last_name: nullableText(200).optional(),
  company: nullableText(200).optional(),
  phone: nullableText(32).optional(),
})
export function createContact(client: UserClient, input: z.input<typeof createContactInput>) {
  return call(
    createContactInput,
    input,
    (v) =>
      client
        .from('contacts')
        .insert({
          workspace_id: v.workspaceId,
          email: v.email,
          first_name: v.first_name ?? null,
          last_name: v.last_name ?? null,
          company: v.company ?? null,
          phone: v.phone ?? null,
          source: 'manual',
        })
        .select('id')
        .single(),
    (row): string => row!.id,
  )
}

export function listWorkspaceTags(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('contacts')
        .select('tags')
        .eq('workspace_id', v.workspaceId)
        .eq('status', 'active')
        .is('merged_into', null)
        .order('updated_at', { ascending: false })
        .limit(1000),
    (rows): string[] => [...new Set((rows ?? []).flatMap((r) => r.tags))].sort(),
  )
}

// ------------------------------------------------------------------ notes

export function listNotes(client: UserClient, input: z.input<typeof contactIdInput>) {
  return call(
    contactIdInput,
    input,
    (v) =>
      client.from('contact_notes').select('*').eq('contact_id', v.contactId).order('created_at', { ascending: false }).limit(200),
    (rows): ContactNote[] => rows ?? [],
  )
}

export const addNoteInput = z.object({ workspaceId: id, contactId: id, author: id, body: z.string().trim().min(1).max(10000) })
export function addNote(client: UserClient, input: z.input<typeof addNoteInput>) {
  return call(
    addNoteInput,
    input,
    (v) =>
      client
        .from('contact_notes')
        .insert({ workspace_id: v.workspaceId, contact_id: v.contactId, author: v.author, body: v.body })
        .select('*')
        .single(),
    (row): ContactNote => row!,
  )
}

export const editNoteInput = z.object({ noteId: id, body: z.string().trim().min(1).max(10000) })
export function editNote(client: UserClient, input: z.input<typeof editNoteInput>) {
  return call(
    editNoteInput,
    input,
    (v) =>
      client.from('contact_notes').update({ body: v.body, updated_at: new Date().toISOString() }).eq('id', v.noteId).select('id').single(),
    () => undefined,
  )
}

export const noteIdInput = z.object({ noteId: id })
export function deleteNote(client: UserClient, input: z.input<typeof noteIdInput>) {
  return call(
    noteIdInput,
    input,
    (v) => client.from('contact_notes').delete().eq('id', v.noteId).select('id'),
    (rows) => {
      if (!rows || rows.length === 0) throw new Error('not deleted')
      return undefined
    },
  )
}

// ------------------------------------------------------------------ activity

/** RLS shows activity_log to admins only; other members get an empty list. */
export function listContactActivity(client: UserClient, input: z.input<typeof contactIdInput>) {
  return call(
    contactIdInput,
    input,
    (v) =>
      client
        .from('activity_log')
        .select('*')
        .eq('entity', 'contact')
        .eq('entity_id', v.contactId)
        .order('created_at', { ascending: false })
        .limit(100),
    (rows): Tables<'activity_log'>[] => rows ?? [],
  )
}

// ------------------------------------------------------------------ field defs

export function listFieldDefs(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.from('contact_field_defs').select('*').eq('workspace_id', v.workspaceId).order('position').order('label'),
    (rows): FieldDef[] => rows ?? [],
  )
}

export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url'] as const
export const createFieldDefInput = z.object({
  workspaceId: id,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  position: z.number().int().default(0),
})
export function createFieldDef(client: UserClient, input: z.input<typeof createFieldDefInput>) {
  return call(
    createFieldDefInput,
    input,
    (v) =>
      client
        .from('contact_field_defs')
        .insert({
          workspace_id: v.workspaceId,
          key: v.key,
          label: v.label,
          type: v.type,
          options: v.options ? asJsonObject(v.options) : null,
          position: v.position,
        })
        .select('*')
        .single(),
    (row): FieldDef => row!,
  )
}

export const updateFieldDefInput = z.object({
  defId: id,
  patch: z
    .object({
      label: z.string().trim().min(1).max(100),
      options: z.array(z.string().trim().min(1).max(100)).max(100),
      position: z.number().int(),
      archived: z.boolean(),
    })
    .partial(),
})
/** Labels change, keys and types never do (doc 04 section 1.4). */
export function updateFieldDef(client: UserClient, input: z.input<typeof updateFieldDefInput>) {
  return call(
    updateFieldDefInput,
    input,
    (v) =>
      client
        .from('contact_field_defs')
        .update({ ...v.patch, ...(v.patch.options ? { options: asJsonObject(v.patch.options) } : {}) })
        .eq('id', v.defId)
        .select('id')
        .single(),
    () => undefined,
  )
}

// ------------------------------------------------------------------ views

export function listContactViews(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('contact_views')
        .select('*')
        .eq('workspace_id', v.workspaceId)
        .order('builtin', { ascending: false })
        .order('name'),
    (rows): ContactView[] => rows ?? [],
  )
}

export const createViewInput = z.object({
  workspaceId: id,
  createdBy: id,
  name: z.string().trim().min(1).max(80),
  filters: jsonObject,
  columns: z.array(z.string()).max(40),
  shared: z.boolean(),
})
export function createContactView(client: UserClient, input: z.input<typeof createViewInput>) {
  return call(
    createViewInput,
    input,
    (v) =>
      client
        .from('contact_views')
        .insert({
          workspace_id: v.workspaceId,
          created_by: v.createdBy,
          name: v.name,
          filters: asJsonObject(v.filters),
          columns: v.columns,
          shared: v.shared,
        })
        .select('id')
        .single(),
    (row): string => row!.id,
  )
}

export const viewIdInput = z.object({ viewId: id })
export function deleteContactView(client: UserClient, input: z.input<typeof viewIdInput>) {
  return call(
    viewIdInput,
    input,
    (v) => client.from('contact_views').delete().eq('id', v.viewId).select('id'),
    (rows) => {
      if (!rows || rows.length === 0) throw new Error('not deleted')
      return undefined
    },
  )
}

// ------------------------------------------------------------------ duplicates

export const dismissInput = z.object({ workspaceId: id, a: id, b: id, userId: id })
/** "Not a duplicate". Pair is stored ordered (contact_a < contact_b). */
export function dismissDuplicate(client: UserClient, input: z.input<typeof dismissInput>) {
  return call(
    dismissInput,
    input,
    (v) => {
      const [x, y] = v.a < v.b ? [v.a, v.b] : [v.b, v.a]
      return client
        .from('contact_duplicate_dismissals')
        .insert({ workspace_id: v.workspaceId, contact_a: x, contact_b: y, dismissed_by: v.userId })
    },
    () => undefined,
  )
}

// ------------------------------------------------------------------ imports

export const createImportInput = z.object({
  workspaceId: id,
  createdBy: id,
  mapping: jsonObject,
  options: z.object({
    on_match: z.enum(['skip', 'fill', 'overwrite']),
    default_tags: z.array(z.string()).max(50),
    default_status: z.enum(LEAD_STATUSES).optional(),
    default_owner: id.optional(),
  }),
})
export function createImport(client: UserClient, input: z.input<typeof createImportInput>) {
  return call(
    createImportInput,
    input,
    (v) =>
      client
        .from('contact_imports')
        .insert({
          workspace_id: v.workspaceId,
          created_by: v.createdBy,
          mapping: asJsonObject(v.mapping),
          options: asJsonObject(v.options),
        })
        .select('id')
        .single(),
    (row): string => row!.id,
  )
}

// ------------------------------------------------------------------ surveys and tokens

export const tokensInput = z.object({ surveyId: id, contactIds: z.array(id).max(500) })
export function listTokens(client: UserClient, input: z.input<typeof tokensInput>) {
  return call(
    tokensInput,
    input,
    (v) => client.from('respondent_tokens').select('*').eq('survey_id', v.surveyId).in('contact_id', v.contactIds),
    (rows): RespondentToken[] => rows ?? [],
  )
}

export const insertTokensInput = z.object({
  workspaceId: id,
  surveyId: id,
  contactIds: z.array(id).max(500),
  maxResponses: z.number().int().min(1).max(1000).default(1),
})
/** Creates tokens for contacts that have none for this survey; existing pairs are left alone. */
export function insertTokens(client: UserClient, input: z.input<typeof insertTokensInput>) {
  return call(
    insertTokensInput,
    input,
    (v) =>
      client.from('respondent_tokens').upsert(
        v.contactIds.map((c) => ({
          workspace_id: v.workspaceId,
          survey_id: v.surveyId,
          contact_id: c,
          max_responses: v.maxResponses,
        })),
        { onConflict: 'survey_id,contact_id', ignoreDuplicates: true },
      ),
    () => undefined,
  )
}

export const topUpTokenInput = z.object({ tokenId: id, maxResponses: z.number().int().min(1) })
/** An exhausted token gets more uses instead of a new token (one per survey and contact). */
export function setTokenMaxResponses(client: UserClient, input: z.input<typeof topUpTokenInput>) {
  return call(
    topUpTokenInput,
    input,
    (v) => client.from('respondent_tokens').update({ max_responses: v.maxResponses }).eq('id', v.tokenId),
    () => undefined,
  )
}

export const contactIdsInput = z.object({ contactIds: z.array(id).min(1).max(5) })
/** Notes and tokens per contact, for the merge summary. */
export function countNotesAndTokens(client: UserClient, input: z.input<typeof contactIdsInput>) {
  return call(
    contactIdsInput,
    input,
    async (v) => {
      const [notes, tokens] = await Promise.all([
        client.from('contact_notes').select('contact_id').in('contact_id', v.contactIds),
        client.from('respondent_tokens').select('contact_id').in('contact_id', v.contactIds),
      ])
      const count = (rows: { contact_id: string }[] | null) => {
        const m: Record<string, number> = {}
        for (const r of rows ?? []) m[r.contact_id] = (m[r.contact_id] ?? 0) + 1
        return m
      }
      return { data: { notes: count(notes.data), tokens: count(tokens.data) }, error: notes.error ?? tokens.error }
    },
  )
}

export type ContactLite = { id: string; email: string | null }

/** Emails for a set of contact ids, 200 per request (exports). Malformed ids are skipped. */
export async function readContactEmails(client: UserClient, ids: string[]): Promise<DbResult<ContactLite[]>> {
  const out: ContactLite[] = []
  for (const part of chunks([...new Set(ids)].filter((x) => id.safeParse(x).success), 200)) {
    const r = await call(z.array(id), part, (v) => client.from('contacts').select('id, email').in('id', v), (rows): ContactLite[] => rows ?? [])
    if (!r.ok) return r
    out.push(...r.data)
  }
  return ok(out)
}

/** Token strings for a set of respondent_tokens ids, 200 per request (exports). */
export async function readTokens(client: UserClient, ids: string[]): Promise<DbResult<{ id: string; token: string }[]>> {
  const out: { id: string; token: string }[] = []
  for (const part of chunks([...new Set(ids)].filter((x) => id.safeParse(x).success), 200)) {
    const r = await call(z.array(id), part, (v) => client.from('respondent_tokens').select('id, token').in('id', v), (rows): { id: string; token: string }[] => rows ?? [])
    if (!r.ok) return r
    out.push(...r.data)
  }
  return ok(out)
}

export type ContactFieldDef = Pick<FieldDef, 'key' | 'label' | 'type'>

/** Live custom field definitions, key, label and type only (builder's contact_field picker). */
export function listContactFields(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('contact_field_defs')
        .select('key, label, type')
        .eq('workspace_id', v.workspaceId)
        .eq('archived', false)
        .order('position'),
    (rows): ContactFieldDef[] => rows ?? [],
  )
}
