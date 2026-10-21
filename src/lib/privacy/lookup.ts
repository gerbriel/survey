import 'server-only'
import { z } from 'zod'
import { fail, ok, toDbError, type DbResult } from '@/lib/db/errors'
import type { UserClient } from '@/lib/supabase/types'

/**
 * Respondent finder for privacy tools (doc 04 section 7.2 step 1 and 2), as
 * the signed-in member under RLS. Finds by email (contacts and merged
 * aliases), by personal link token, or by contact id, then counts what an
 * erase would touch.
 *
 * Decision: email answers on anonymous responses are not searched; those
 * responses have no contact for erase_respondent to act on. Members remove
 * them from the response inbox (Phase 2D).
 *
 * TODO(foundation): these table reads belong in src/lib/db/privacy.ts.
 */

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

const email = z.string().trim().toLowerCase().email().max(320)
const uuid = z.guid()

function name(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

export type LookupQuery = { kind: 'email' | 'token' | 'id'; value: string }

export function parseLookup(raw: string): LookupQuery | null {
  let v = raw.trim()
  if (!v) return null
  // A pasted personal link (https://PUBLIC_HOST/{slug}?t={token}) works too.
  if (/^https?:\/\//i.test(v)) {
    try {
      v = new URL(v).searchParams.get('t') ?? ''
    } catch {
      return null
    }
    if (!v) return null
  }
  if (email.safeParse(v).success) return { kind: 'email', value: v.toLowerCase() }
  if (uuid.safeParse(v).success) return { kind: 'id', value: v }
  if (/^[A-Za-z0-9_-]{8,100}$/.test(v)) return { kind: 'token', value: v }
  return null
}

export async function findRespondents(supabase: UserClient, workspaceId: string, q: LookupQuery): Promise<DbResult<RespondentMatch[]>> {
  try {
    const cols = 'id, email, first_name, last_name, status, merged_into'
    const out = new Map<string, RespondentMatch>()
    const add = (c: { id: string; email: string | null; first_name: string | null; last_name: string | null; status: string }, by: RespondentMatch['matchedBy']) => {
      if (!out.has(c.id)) out.set(c.id, { id: c.id, email: c.email, name: name(c), status: c.status, matchedBy: by })
    }
    if (q.kind === 'email') {
      const direct = await supabase.from('contacts').select(cols).eq('workspace_id', workspaceId).ilike('email', q.value).is('merged_into', null).limit(20)
      if (direct.error) return fail(toDbError(direct.error))
      for (const c of direct.data ?? []) add(c, 'email')
      const aliases = await supabase.from('contact_aliases').select('contact_id').eq('workspace_id', workspaceId).ilike('email', q.value).limit(20)
      if (aliases.error) return fail(toDbError(aliases.error))
      const ids = (aliases.data ?? []).map((a) => a.contact_id)
      if (ids.length) {
        const viaAlias = await supabase.from('contacts').select(cols).in('id', ids)
        if (viaAlias.error) return fail(toDbError(viaAlias.error))
        for (const c of viaAlias.data ?? []) add(c, 'alias')
      }
    } else if (q.kind === 'token') {
      const t = await supabase.from('respondent_tokens').select('contact_id').eq('workspace_id', workspaceId).eq('token', q.value).maybeSingle()
      if (t.error) return fail(toDbError(t.error))
      if (t.data) {
        const c = await supabase.from('contacts').select(cols).eq('id', t.data.contact_id).maybeSingle()
        if (c.error) return fail(toDbError(c.error))
        if (c.data) add(c.data, 'token')
      }
    } else {
      const c = await supabase.from('contacts').select(cols).eq('workspace_id', workspaceId).eq('id', q.value).maybeSingle()
      if (c.error) return fail(toDbError(c.error))
      if (c.data) add(c.data, 'id')
    }
    return ok([...out.values()])
  } catch (e) {
    return fail(toDbError(e))
  }
}

/** What an erase would touch (step 2, Review). Counts the contact plus every contact merged into it. */
export async function reviewRespondent(supabase: UserClient, contact: RespondentMatch): Promise<DbResult<RespondentReview>> {
  try {
    const family = [contact.id]
    const merged = await supabase.from('contacts').select('id').eq('merged_into', contact.id).limit(100)
    if (!merged.error) family.push(...(merged.data ?? []).map((m) => m.id))
    const [responses, notes, tokens] = await Promise.all([
      supabase.from('responses').select('id, survey_id').in('contact_id', family).limit(5000),
      supabase.from('contact_notes').select('id', { count: 'exact', head: true }).in('contact_id', family),
      supabase.from('respondent_tokens').select('id', { count: 'exact', head: true }).in('contact_id', family),
    ])
    if (responses.error) return fail(toDbError(responses.error))
    const ids = (responses.data ?? []).map((r) => r.id)
    let files = 0
    for (let i = 0; i < ids.length; i += 200) {
      const f = await supabase.from('response_files').select('id', { count: 'exact', head: true }).in('response_id', ids.slice(i, i + 200))
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
