'use server'

import { revalidatePath } from 'next/cache'
import { requireMember } from '@/lib/auth'
import { deleteResponse, getInboxRow, type InboxRow } from '@/lib/db/responses'

/**
 * Realtime refetch: the inbox passes only the id from the change event and
 * gets the row back through the wrapper, under the caller's RLS.
 */
export async function fetchInboxRowAction(slug: string, surveyId: string, responseId: string): Promise<InboxRow | null> {
  const { supabase } = await requireMember(slug, 'viewer')
  const r = await getInboxRow(supabase, { responseId })
  if (!r.ok || !r.data || r.data.survey_id !== surveyId) return null
  return r.data
}

/** Admin and above (RLS responses_delete). */
export async function deleteResponseAction(
  slug: string,
  surveyId: string,
  responseId: string,
): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireMember(slug, 'admin')
  const r = await deleteResponse(supabase, { responseId })
  if (!r.ok) return { ok: false, message: r.error.message }
  revalidatePath(`/w/${slug}/surveys/${surveyId}/responses`)
  return { ok: true }
}
