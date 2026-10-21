'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth'
import {
  adminApproveAccessRequest,
  adminCloseSurvey,
  adminCreateWorkspace,
  adminSetWorkspaceLimits,
  createWorkspaceInput,
  restoreWorkspace,
} from '@/lib/db/admin'
import {
  archiveWorkspace,
  requestWorkspaceDeletion,
  transferWorkspaceOwnership,
  unarchiveWorkspace,
} from '@/lib/db/workspaces'
import {
  createPlatformInvite,
  createPlatformInviteInput,
  revokePlatformInvite,
  setAbuseReportStatus,
  setProfileStatus,
  updatePrivacyNotice,
  updatePrivacyNoticeInput,
} from '@/lib/admin/db/platform'
import { dismissAccessRequest, dismissWorkspaceRequest } from '@/lib/admin/db/requests'
import { auditPlatformAction, mintPasswordResetLink, setAuthBan } from '@/lib/admin/service'
import { inviteUrl } from '@/lib/admin/links'
import { failure, formBool, formFields, fromDbError, fromZodError, success, type ActionState } from '@/lib/admin/forms'
import { parseLimitsForm } from '@/lib/admin/limits-form'

/**
 * Platform admin mutations (doc 05 section 6). requirePlatformAdmin is the
 * UX guard; the SQL functions and is_platform_admin() RLS policies are the
 * authorization. Service-role work goes through src/lib/admin/service.ts,
 * which checks platform admin again before it creates the admin client.
 */

const uuid = z.guid()
const idFrom = (form: FormData, key: string) => uuid.safeParse(form.get(key))

// --- invites ---------------------------------------------------------------

const inviteForm = createPlatformInviteInput.omit({ invitedBy: true }).extend({
  expiresInDays: z.coerce.number().pipe(createPlatformInviteInput.shape.expiresInDays),
})

export async function issuePlatformInvite(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = inviteForm.safeParse(formFields(form, ['email', 'note']))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await createPlatformInvite(ctx.supabase, { invitedBy: ctx.user.id, ...parsed.data })
  if (!r.ok) {
    if (r.error.code === 'unique_violation') return failure('There is already an open invite for that email.', { email: 'Already invited.' })
    return fromDbError(r.error)
  }
  await auditPlatformAction({ action: 'invite.create', targetType: 'invite', targetId: r.data.id, details: { email: r.data.email } })
  revalidatePath('/admin/invites')
  return success('Invite created. Copy the link and share it. Nothing is emailed.', { url: inviteUrl(r.data.token) })
}

export async function revokePlatformInviteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'inviteId')
  if (!id.success) return failure('Pick an invite.')
  const r = await revokePlatformInvite(ctx.supabase, { inviteId: id.data })
  if (!r.ok) return fromDbError(r.error)
  await auditPlatformAction({ action: 'invite.revoke', targetType: 'invite', targetId: id.data })
  revalidatePath('/admin/invites')
  return success('Invite revoked.')
}

// --- requests --------------------------------------------------------------

export async function approveAccessRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'requestId')
  if (!id.success) return failure('Pick a request.')
  const r = await adminApproveAccessRequest(ctx.supabase, { requestId: id.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Approved. The person is active now and can sign in.')
}

export async function dismissAccessRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'requestId')
  if (!id.success) return failure('Pick a request.')
  const r = await dismissAccessRequest(ctx.supabase, { requestId: id.data, reviewerId: ctx.user.id })
  if (!r.ok) return fromDbError(r.error)
  await auditPlatformAction({ action: 'access_request.dismiss', targetType: 'user', targetId: null, details: { request_id: id.data } })
  revalidatePath('/admin', 'layout')
  return success('Request dismissed.')
}

export async function dismissWorkspaceRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'requestId')
  if (!id.success) return failure('Pick a request.')
  const r = await dismissWorkspaceRequest(ctx.supabase, { requestId: id.data, reviewerId: ctx.user.id })
  if (!r.ok) return fromDbError(r.error)
  await auditPlatformAction({ action: 'workspace_request.dismiss', targetType: 'workspace', targetId: null, details: { request_id: id.data } })
  revalidatePath('/admin', 'layout')
  return success('Request dismissed.')
}

// --- workspaces ------------------------------------------------------------

const createForm = createWorkspaceInput.extend({ requestId: z.guid().nullable() })

export async function createWorkspaceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = createForm.safeParse(formFields(form, ['requestId']))
  if (!parsed.success) {
    const st = fromZodError(parsed.error)
    if (st.fieldErrors?.slug) st.fieldErrors.slug = 'Use 3 to 40 lowercase letters, numbers and single hyphens.'
    if (st.fieldErrors?.ownerId) st.fieldErrors.ownerId = 'Pick the first owner.'
    return st
  }
  const { requestId, ...rest } = parsed.data
  const r = await adminCreateWorkspace(ctx.supabase, requestId ? { ...rest, requestId } : rest)
  if (!r.ok) {
    const st = fromDbError(r.error)
    return r.error.code === 'slug_taken' ? { ...st, fieldErrors: { slug: st.message ?? '' } } : st
  }
  revalidatePath('/admin', 'layout')
  redirect(`/admin/workspaces/${r.data}?created=1`)
}

export async function setLimitsAction(workspaceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = parseLimitsForm(form)
  if (!parsed.ok) return parsed.state
  const r = await adminSetWorkspaceLimits(ctx.supabase, { workspaceId, limits: parsed.limits, note: parsed.note })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`/admin/workspaces/${workspaceId}`)
  return success('Limits saved. The change is in the audit log.')
}

export async function adminArchive(workspaceId: string): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const r = await archiveWorkspace(ctx.supabase, { workspaceId })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Workspace archived.')
}

export async function adminUnarchive(workspaceId: string): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const r = await unarchiveWorkspace(ctx.supabase, { workspaceId })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Workspace unarchived.')
}

export async function adminRequestDeletion(workspaceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const confirmSlug = String(form.get('confirmSlug') ?? '').trim()
  if (!confirmSlug) return failure('Type the workspace address to confirm.', { confirmSlug: 'Required.' })
  const r = await requestWorkspaceDeletion(ctx.supabase, { workspaceId, confirmSlug })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Deletion requested. You can restore it for 30 days.')
}

export async function adminRestore(workspaceId: string): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const r = await restoreWorkspace(ctx.supabase, { workspaceId })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Workspace restored. It is still archived; unarchive it when ready.')
}

export async function adminForceTransfer(workspaceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'userId')
  if (!id.success) return failure('Pick the new owner.', { userId: 'Required.' })
  const r = await transferWorkspaceOwnership(ctx.supabase, { workspaceId, newOwnerId: id.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Ownership transferred. The previous owner is now an admin.')
}

// --- users -----------------------------------------------------------------

export async function mintResetLink(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin()
  const id = idFrom(form, 'userId')
  if (!id.success) return failure('Pick a user.')
  const r = await mintPasswordResetLink(id.data)
  if (!r.ok) return fromDbError(r.error)
  return success(`Reset link for ${r.data.email}. Copy it now: it is shown once and never stored.`, { link: r.data.link })
}

export async function setUserActive(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'userId')
  if (!id.success) return failure('Pick a user.')
  if (id.data === ctx.user.id) return failure('You cannot deactivate yourself.')
  const active = formBool(form, 'active')
  // Status first under RLS, so the owner guard refuses before anything is banned.
  const r = await setProfileStatus(ctx.supabase, { userId: id.data, status: active ? 'active' : 'disabled' })
  if (!r.ok) {
    if (r.error.code === 'guard_violation') return failure('Transfer ownership of every workspace this user owns first.')
    return fromDbError(r.error)
  }
  const ban = await setAuthBan(id.data, !active)
  if (!ban.ok) return failure(`Status changed, but sign-in could not be ${active ? 'unblocked' : 'blocked'}: ${ban.error.message}`)
  revalidatePath('/admin/users')
  return success(active ? 'User reactivated.' : 'User deactivated. They can no longer sign in.')
}

// --- privacy notice --------------------------------------------------------

export async function savePrivacyNotice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = updatePrivacyNoticeInput.omit({ updatedBy: true }).safeParse({ markdown: String(form.get('markdown') ?? '') })
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await updatePrivacyNotice(ctx.supabase, { updatedBy: ctx.user.id, markdown: parsed.data.markdown })
  if (!r.ok) return fromDbError(r.error)
  await auditPlatformAction({ action: 'settings.privacy_notice', targetType: 'settings', targetId: null, details: { length: parsed.data.markdown.length } })
  revalidatePath('/privacy')
  revalidatePath('/admin/privacy')
  return success('Privacy notice saved. The public page shows it now.')
}

// --- abuse reports ---------------------------------------------------------

const statusForm = z.object({ reportId: z.guid(), status: z.enum(['open', 'dismissed', 'actioned']) })

export async function setReportStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = statusForm.safeParse(formFields(form))
  if (!parsed.success) return failure('Pick a report and a status.')
  const r = await setAbuseReportStatus(ctx.supabase, { ...parsed.data, reviewerId: ctx.user.id })
  if (!r.ok) return fromDbError(r.error)
  await auditPlatformAction({ action: `abuse_report.${parsed.data.status}`, targetType: 'abuse_report', targetId: parsed.data.reportId })
  revalidatePath('/admin', 'layout')
  return success('Report updated.')
}

const closeForm = z.object({
  reportId: z.guid(),
  surveyId: z.guid(),
  reason: z.string().trim().min(1, 'Add a reason the owners will see.').max(1000),
})

export async function closeReportedSurvey(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = closeForm.safeParse(formFields(form))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await adminCloseSurvey(ctx.supabase, { surveyId: parsed.data.surveyId, reason: parsed.data.reason })
  if (!r.ok) return fromDbError(r.error)
  await setAbuseReportStatus(ctx.supabase, { reportId: parsed.data.reportId, reviewerId: ctx.user.id, status: 'actioned' })
  revalidatePath('/admin', 'layout')
  return success('Survey closed and report marked actioned.')
}

export async function archiveReportedWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = z.object({ reportId: z.guid(), workspaceId: z.guid() }).safeParse(formFields(form))
  if (!parsed.success) return failure('Pick a report.')
  const r = await archiveWorkspace(ctx.supabase, { workspaceId: parsed.data.workspaceId })
  if (!r.ok) return fromDbError(r.error)
  await setAbuseReportStatus(ctx.supabase, { reportId: parsed.data.reportId, reviewerId: ctx.user.id, status: 'actioned' })
  revalidatePath('/admin', 'layout')
  return success('Workspace archived and report marked actioned.')
}
