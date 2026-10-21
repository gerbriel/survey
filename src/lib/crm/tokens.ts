import 'server-only'
import type { UserClient } from '@/lib/supabase/types'
import {
  insertTokens,
  listContactsByEmails,
  listContactsByIds,
  listSurveysLite,
  listTokens,
  setTokenMaxResponses,
  type Contact,
} from './data/contacts'
import { chunk } from './import'
import { linksCsv, publicSurveyLink, type LinkRow } from './links'

/**
 * Personalized link generation (doc 04 section 1.5 step 6), under RLS with
 * the member client (respondent_tokens needs editor).
 *
 * Decisions:
 * - One token per survey and contact (unique in SQL). An existing usable
 *   token is reused. An exhausted one gets its max_responses raised by the
 *   requested amount instead of a new token.
 * - Revoked or expired tokens are not revived: those contacts are skipped and
 *   counted, since someone deliberately turned that link off.
 */
export async function generateLinks(
  client: UserClient,
  input: { workspaceId: string; surveyId: string; contactIds?: string[]; emails?: string[]; maxResponses: number },
  env: { publicHost?: string; nodeEnv?: string } = { publicHost: process.env.PUBLIC_HOST, nodeEnv: process.env.NODE_ENV },
): Promise<{ ok: true; data: { csv: string; count: number; skipped: number } } | { ok: false; message: string }> {
  if (!env.publicHost) return { ok: false, message: 'PUBLIC_HOST is not configured on the server.' }
  const max = Math.min(Math.max(1, Math.trunc(input.maxResponses || 1)), 1000)
  const surveys = await listSurveysLite(client, { workspaceId: input.workspaceId })
  if (!surveys.ok) return { ok: false, message: surveys.error.message }
  const survey = surveys.data.find((s) => s.id === input.surveyId)
  if (!survey || !survey.latest_published_version_id) return { ok: false, message: 'Pick a survey with a published version.' }

  const rows: LinkRow[] = []
  let skipped = 0
  const keys = input.contactIds?.length ? input.contactIds : (input.emails ?? [])
  const byIds = !!input.contactIds?.length
  for (const part of chunk([...new Set(keys)], 500)) {
    const contactsR = byIds
      ? await listContactsByIds(client, { workspaceId: input.workspaceId, ids: part })
      : await listContactsByEmails(client, { workspaceId: input.workspaceId, emails: part })
    if (!contactsR.ok) return { ok: false, message: contactsR.error.message }
    const contacts: Contact[] = contactsR.data.filter((c) => c.status === 'active' && !c.merged_into)
    skipped += part.length - contacts.length
    if (contacts.length === 0) continue
    const ids = contacts.map((c) => c.id)
    const existing = await listTokens(client, { surveyId: survey.id, contactIds: ids })
    if (!existing.ok) return { ok: false, message: existing.error.message }
    const have = new Set(existing.data.map((t) => t.contact_id))
    const missing = ids.filter((cid) => !have.has(cid))
    if (missing.length) {
      const ins = await insertTokens(client, {
        workspaceId: input.workspaceId,
        surveyId: survey.id,
        contactIds: missing,
        maxResponses: max,
      })
      if (!ins.ok) return { ok: false, message: ins.error.message }
    }
    const tokens = missing.length ? await listTokens(client, { surveyId: survey.id, contactIds: ids }) : existing
    if (!tokens.ok) return { ok: false, message: tokens.error.message }
    const now = Date.now()
    for (const c of contacts) {
      const t = tokens.data.find((x) => x.contact_id === c.id)
      if (!t || t.revoked_at || (t.expires_at && Date.parse(t.expires_at) <= now)) {
        skipped++
        continue
      }
      if (t.used_count >= t.max_responses) {
        const up = await setTokenMaxResponses(client, { tokenId: t.id, maxResponses: t.used_count + max })
        if (!up.ok) {
          skipped++
          continue
        }
      }
      rows.push({
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        company: c.company,
        link: publicSurveyLink(env.publicHost, survey.slug, t.token, env.nodeEnv),
      })
    }
  }
  return { ok: true, data: { csv: linksCsv(rows), count: rows.length, skipped } }
}
