import 'server-only'
import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { asJson as asJsonRaw, call, id, jsonObject } from '@/lib/db/rpc'

const asJson = (v: unknown) => asJsonRaw(v) as NonNullable<Json>
import { LEAD_STATUSES } from '../import'

/**
 * CRM table queries under RLS that the frozen src/lib/db/contacts.ts does not
 * cover yet (contact reads and edits, notes, field defs, views, tokens,
 * dismissals, imports, members). Same contract as src/lib/db: zod input, one
 * query, DbResult out, never throws, member client only.
 *
 * TODO(Phase 3): move into src/lib/db/crm.ts (Foundation change request in
 * the Phase 2D report). Kept here because src/lib/db is frozen for Phase 2.
 */
export type Contact = Tables<'contacts'>
export type ContactNote = Tables<'contact_notes'>
export type FieldDef = Tables<'contact_field_defs'>
export type ContactView = Tables<'contact_views'>
export type RespondentToken = Tables<'respondent_tokens'>

const contactIdInput = z.object({ contactId: id })
const workspaceIdInput = z.object({ workspaceId: id })

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

// ------------------------------------------------------------------ members

export type MemberLite = { user_id: string; role: string; display_name: string }
export function listMembers(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('workspace_members')
        .select('user_id, role, profile:profiles!workspace_members_user_id_fkey(display_name)')
        .eq('workspace_id', v.workspaceId),
    (rows): MemberLite[] =>
      (rows ?? [])
        .map((r) => ({
          user_id: r.user_id,
          role: r.role,
          display_name: (r.profile as { display_name: string } | null)?.display_name ?? 'Member',
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
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

export type ActivityRow = Tables<'activity_log'>
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
    (rows): ActivityRow[] => rows ?? [],
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
          options: v.options ? asJson(v.options) : null,
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
        .update({ ...v.patch, ...(v.patch.options ? { options: asJson(v.patch.options) } : {}) })
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
          filters: asJson(v.filters),
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
          mapping: asJson(v.mapping),
          options: asJson(v.options),
        })
        .select('id')
        .single(),
    (row): string => row!.id,
  )
}

// ------------------------------------------------------------------ surveys and tokens

export type SurveyLite = Pick<Tables<'surveys'>, 'id' | 'title' | 'slug' | 'state' | 'latest_published_version_id'>
/** Surveys with a published version, for the link generator and filters. */
export function listSurveysLite(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('surveys')
        .select('id, title, slug, state, latest_published_version_id')
        .eq('workspace_id', v.workspaceId)
        .is('archived_at', null)
        .order('title'),
    (rows): SurveyLite[] => rows ?? [],
  )
}

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

export type { Json }

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
