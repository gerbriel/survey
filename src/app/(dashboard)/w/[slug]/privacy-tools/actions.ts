'use server'

import { revalidatePath } from 'next/cache'
import { requireMember } from '@/lib/auth'
import { confirmMatches, eraseRespondentFully } from '@/lib/privacy/erase'
import { findRespondents } from '@/lib/privacy/lookup'

export type EraseState = { status: 'idle' | 'done' | 'error'; message: string }

/**
 * Erase one respondent (doc 04 section 7.2 steps 3 to 5), admin and owner.
 * The confirm text must be the contact's email, or DELETE. SQL re-checks the
 * role, runs in one transaction and logs the erase with a hash of the email.
 */
export async function eraseAction(slug: string, contactId: string, _prev: EraseState, formData: FormData): Promise<EraseState> {
  const m = await requireMember(slug, 'admin')
  const mode = formData.get('mode') === 'hard' ? 'hard' : formData.get('mode') === 'anonymize' ? 'anonymize' : null
  if (!mode) return { status: 'error', message: 'Pick hard delete or anonymize.' }
  const found = await findRespondents(m.supabase, m.workspace.id, { kind: 'id', value: contactId })
  const contact = found.ok ? found.data[0] : undefined
  if (!contact) return { status: 'error', message: 'We could not find that contact.' }
  if (!confirmMatches(String(formData.get('confirm') ?? ''), contact.email)) {
    return { status: 'error', message: contact.email ? 'Type the email address or DELETE to confirm.' : 'Type DELETE to confirm.' }
  }
  const r = await eraseRespondentFully(m.supabase, { contactId, mode })
  if (!r.ok) return { status: 'error', message: r.error.message }
  revalidatePath(`/w/${slug}/privacy-tools`)
  const files = r.data.filesFailed ? ` ${r.data.filesFailed} files could not be removed yet and will be retried.` : ''
  return { status: 'done', message: mode === 'hard' ? `Everything about this respondent was deleted.${files}` : `This respondent was anonymized; their answers stay in aggregates.${files}` }
}
