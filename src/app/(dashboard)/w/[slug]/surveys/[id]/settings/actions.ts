'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertBelongsToWorkspace } from '@/lib/scope'
import { addSurveyCollaborator, removeSurveyCollaborator, setSurveyOwner } from '@/lib/db/assignments'
import { failure, fromDbError, success, type ActionState } from '@/lib/admin/forms'

/**
 * People section of the survey Settings tab (R19). Each action ties the
 * survey to the workspace in the slug (D-15) and requires editor for a clean
 * redirect. UX only: the SQL functions check editor themselves, refuse
 * non-members, and write activity_log.
 */

const uuid = z.guid()
const settingsPath = (slug: string, surveyId: string) => `/w/${encodeURIComponent(slug)}/surveys/${surveyId}/settings`

export async function setOwnerAction(slug: string, surveyId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { member } = await assertBelongsToWorkspace(slug, { surveyId }, 'editor')
  const userId = uuid.safeParse(form.get('userId'))
  if (!userId.success) return failure('Pick the new owner.', { userId: 'Required.' })
  const r = await setSurveyOwner(member.supabase, { surveyId, userId: userId.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(settingsPath(slug, surveyId))
  return success('Owner updated. The previous owner stays on as a collaborator.')
}

export async function addCollaboratorsAction(slug: string, surveyId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { member } = await assertBelongsToWorkspace(slug, { surveyId }, 'editor')
  const ids = z.array(uuid).min(1).max(50).safeParse([...new Set(form.getAll('userId'))])
  if (!ids.success) return failure('Pick one or more members to add.')
  for (const userId of ids.data) {
    const r = await addSurveyCollaborator(member.supabase, { surveyId, userId })
    if (!r.ok) {
      revalidatePath(settingsPath(slug, surveyId))
      return fromDbError(r.error)
    }
  }
  revalidatePath(settingsPath(slug, surveyId))
  return success(ids.data.length === 1 ? 'Collaborator added.' : `${ids.data.length} collaborators added.`)
}

export async function removeCollaboratorAction(slug: string, surveyId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { member } = await assertBelongsToWorkspace(slug, { surveyId }, 'editor')
  const userId = uuid.safeParse(form.get('userId'))
  if (!userId.success) return failure('Pick a collaborator.')
  const r = await removeSurveyCollaborator(member.supabase, { surveyId, userId: userId.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(settingsPath(slug, surveyId))
  return success('Collaborator removed.')
}
