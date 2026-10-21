'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { claimPendingInvite } from '@/lib/db/invites'
import {
  createAccessRequest,
  createAccessRequestInput,
  createWorkspaceRequest,
  createWorkspaceRequestInput,
} from '@/lib/admin/db/requests'
import { failure, formFields, fromDbError, fromZodError, success, type ActionState } from '@/lib/admin/forms'

/** Onboarding actions: /pending (access requests) and the no-workspace welcome at / (workspace requests). */

/** "Check again": the email match claim (Fresno 00012). */
export async function checkAgain(): Promise<ActionState> {
  const ctx = await requireUser({ allowPending: true })
  const r = await claimPendingInvite(ctx.supabase)
  if (!r.ok) return fromDbError(r.error)
  if (r.data.status === 'activated' || r.data.status === 'active') redirect('/')
  return failure('Still no invite for this email. Open the invite link you were sent, or request access below.')
}

const accessRequest = createAccessRequestInput.omit({ userId: true })

export async function requestAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireUser({ allowPending: true })
  const parsed = accessRequest.safeParse(formFields(form, ['department', 'reason']))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await createAccessRequest(ctx.supabase, { userId: ctx.user.id, ...parsed.data })
  if (!r.ok) {
    if (r.error.code === 'unique_violation') return failure('You already have an open request. A platform admin will review it.')
    return fromDbError(r.error)
  }
  revalidatePath('/pending')
  return success('Request sent. A platform admin will review it. Use Check again later.')
}

const workspaceRequest = createWorkspaceRequestInput.omit({ userId: true })

export async function requestWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireUser()
  const parsed = workspaceRequest.safeParse(formFields(form, ['purpose']))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await createWorkspaceRequest(ctx.supabase, { userId: ctx.user.id, ...parsed.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/')
  return success('Request sent. A platform admin will create the workspace or follow up.')
}
