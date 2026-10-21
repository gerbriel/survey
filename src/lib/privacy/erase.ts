import 'server-only'
import { eraseRespondent } from '@/lib/db/privacy'
import type { DbResult } from '@/lib/db/errors'
import { ok } from '@/lib/db/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserClient } from '@/lib/supabase/types'
import { deleteQueuedObjects } from './storage'

/**
 * Respondent erase (doc 04 sections 7.2 to 7.4). erase_respondent runs as the
 * signed-in member: SQL checks admin and above, does the whole erase in one
 * transaction, and writes the activity_log entry (mode, counts, sha256 of the
 * email, never the email). The queued Storage objects are then deleted at
 * once with the service role, which is the only part members cannot do.
 */
export async function eraseRespondentFully(
  supabase: UserClient,
  input: { contactId: string; mode: 'hard' | 'anonymize' },
): Promise<DbResult<{ filesDeleted: number; filesFailed: number }>> {
  const r = await eraseRespondent(supabase, input)
  if (!r.ok) return r
  if (r.data.length === 0) return ok({ filesDeleted: 0, filesFailed: 0 })
  const res = await deleteQueuedObjects(createAdminClient(), r.data)
  // Failures stay queued with attempts + 1; the storage sweep cron retries them.
  return ok({ filesDeleted: res.done, filesFailed: res.failed })
}

/** What the confirm box must contain: the email, or DELETE when there is none. */
export function confirmPhrase(email: string | null): string {
  return email ?? 'DELETE'
}

export function confirmMatches(typed: string, email: string | null): boolean {
  const t = typed.trim()
  return t === 'DELETE' || (email !== null && t.toLowerCase() === email.toLowerCase())
}
