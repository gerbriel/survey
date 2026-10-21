import { z } from 'zod'
import type { Json } from '@/types/db-helpers'
import type { AdminClient, UserClient } from '@/lib/supabase/types'
import { fail, ok, toDbError, type DbResult } from './errors'
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

/** Service role (retention cron): live workspaces with retention_days set. */
export function listRetentionWorkspaces(admin: AdminClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => admin.from('workspaces').select('id').not('retention_days', 'is', null).is('deleted_at', null),
    (rows): string[] => (rows ?? []).map((r) => r.id),
  )
}

export const retentionDueInput = z.object({ workspaceId: id, cutoff: z.iso.datetime({ offset: true }) })

/** As the member: responses the next retention run would delete (submitted, or started, before the cutoff). */
export function countRetentionDue(client: UserClient, input: z.input<typeof retentionDueInput>) {
  return call(
    retentionDueInput,
    input,
    (v) =>
      client
        .from('responses')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', v.workspaceId)
        .or(`submitted_at.lt.${v.cutoff},and(submitted_at.is.null,started_at.lt.${v.cutoff})`)
        .then((r) => ({ data: r.count, error: r.error })),
    (n): number => n ?? 0,
  )
}

// ---------------------------------------------------------------------------
// Respondent finder for privacy tools (doc 04 section 7.2 steps 1 and 2), as
// the signed-in member under RLS. Finds by email (contacts and merged
// aliases), by personal link token, or by contact id, then counts what an
// erase would touch.
//
// Decision: email answers on anonymous responses are not searched; those
// responses have no contact for erase_respondent to act on. Members remove
// them from the response inbox.
// ---------------------------------------------------------------------------

export type RespondentMatch = {
  id: string
  email: string | null
  name: string
  status: string
  matchedBy: 'email' | 'alias' | 'token' | 'id'
}

export type RespondentReview = {
  contact: RespondentMatch
  responses: number
  surveys: number
  notes: number
  tokens: number
  files: number
}

export const lookupQuery = z.object({ kind: z.enum(['email', 'token', 'id']), value: z.string().trim().min(1).max(320) })
export type LookupQuery = z.infer<typeof lookupQuery>

export const findRespondentsInput = z.object({ workspaceId: id, query: lookupQuery })

function fullName(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

export async function findRespondents(
  client: UserClient,
  input: z.input<typeof findRespondentsInput>,
): Promise<DbResult<RespondentMatch[]>> {
  const parsed = findRespondentsInput.safeParse(input)
  if (!parsed.success) return call(findRespondentsInput, input, async () => ({ data: null, error: null }))
  const { workspaceId, query: q } = parsed.data
  try {
    const cols = 'id, email, first_name, last_name, status, merged_into'
    const out = new Map<string, RespondentMatch>()
    const add = (
      c: { id: string; email: string | null; first_name: string | null; last_name: string | null; status: string },
      by: RespondentMatch['matchedBy'],
    ) => {
      if (!out.has(c.id)) out.set(c.id, { id: c.id, email: c.email, name: fullName(c), status: c.status, matchedBy: by })
    }
    if (q.kind === 'email') {
      const direct = await client.from('contacts').select(cols).eq('workspace_id', workspaceId).ilike('email', q.value).is('merged_into', null).limit(20)
      if (direct.error) return fail(toDbError(direct.error))
      for (const c of direct.data ?? []) add(c, 'email')
      const aliases = await client.from('contact_aliases').select('contact_id').eq('workspace_id', workspaceId).ilike('email', q.value).limit(20)
      if (aliases.error) return fail(toDbError(aliases.error))
      const ids = (aliases.data ?? []).map((a) => a.contact_id)
      if (ids.length) {
        const viaAlias = await client.from('contacts').select(cols).in('id', ids)
        if (viaAlias.error) return fail(toDbError(viaAlias.error))
        for (const c of viaAlias.data ?? []) add(c, 'alias')
      }
    } else if (q.kind === 'token') {
      const t = await client.from('respondent_tokens').select('contact_id').eq('workspace_id', workspaceId).eq('token', q.value).maybeSingle()
      if (t.error) return fail(toDbError(t.error))
      if (t.data) {
        const c = await client.from('contacts').select(cols).eq('id', t.data.contact_id).maybeSingle()
        if (c.error) return fail(toDbError(c.error))
        if (c.data) add(c.data, 'token')
      }
    } else {
      const c = await client.from('contacts').select(cols).eq('workspace_id', workspaceId).eq('id', q.value).maybeSingle()
      if (c.error) return fail(toDbError(c.error))
      if (c.data) add(c.data, 'id')
    }
    return ok([...out.values()])
  } catch (e) {
    return fail(toDbError(e))
  }
}

/** What an erase would touch (step 2, Review). Counts the contact plus every contact merged into it. */
export async function reviewRespondent(
  client: UserClient,
  input: { contact: RespondentMatch },
): Promise<DbResult<RespondentReview>> {
  const { contact } = input
  if (!id.safeParse(contact.id).success) return call(z.object({ contactId: id }), { contactId: contact.id }, async () => ({ data: null, error: null }))
  try {
    const family = [contact.id]
    const merged = await client.from('contacts').select('id').eq('merged_into', contact.id).limit(100)
    if (!merged.error) family.push(...(merged.data ?? []).map((m) => m.id))
    const [responses, notes, tokens] = await Promise.all([
      client.from('responses').select('id, survey_id').in('contact_id', family).limit(5000),
      client.from('contact_notes').select('id', { count: 'exact', head: true }).in('contact_id', family),
      client.from('respondent_tokens').select('id', { count: 'exact', head: true }).in('contact_id', family),
    ])
    if (responses.error) return fail(toDbError(responses.error))
    const ids = (responses.data ?? []).map((r) => r.id)
    let files = 0
    for (let i = 0; i < ids.length; i += 200) {
      const f = await client.from('response_files').select('id', { count: 'exact', head: true }).in('response_id', ids.slice(i, i + 200))
      files += f.count ?? 0
    }
    return ok({
      contact,
      responses: ids.length,
      surveys: new Set((responses.data ?? []).map((r) => r.survey_id)).size,
      notes: notes.count ?? 0,
      tokens: tokens.count ?? 0,
      files,
    })
  } catch (e) {
    return fail(toDbError(e))
  }
}
