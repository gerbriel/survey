'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth'
import {
  adminApproveAccessRequest,
  adminCreateWorkspace,
  adminSetWorkspaceLimits,
  createWorkspaceInput,
  restoreWorkspace,
  adminIssuePlatformInvite,
  createPlatformInviteInput,
  adminRevokePlatformInvite,
  setProfileStatus,
  adminUpdatePrivacyNotice,
  updatePrivacyNoticeInput,
  adminDismissAccessRequest,
  adminDismissWorkspaceRequest,
  adminAddWorkspaceMember,
  adminRemoveWorkspaceMember,
  adminSetMemberRole,
} from '@/lib/db/admin'
import {
  archiveWorkspace,
  getWorkspaceById,
  requestWorkspaceDeletion,
  transferWorkspaceOwnership,
  unarchiveWorkspace,
} from '@/lib/db/workspaces'
import { mintPasswordResetLink, setAuthBan } from '@/lib/admin/service'
import { RESET_REFUSED_MESSAGE } from '@/lib/admin/reset-guard'
import { inviteUrl } from '@/lib/admin/links'
import { failure, formBool, formFields, fromDbError, fromZodError, success, type ActionState } from '@/lib/admin/forms'
import { parseLimitsForm } from '@/lib/admin/limits-form'

/**
 * Platform admin mutations (doc 05 section 6). requirePlatformAdmin is the
 * UX guard; the SQL functions and is_platform_admin() RLS policies are the
 * authorization; the admin_* functions write the platform audit log
 * themselves. Auth admin API work goes through src/lib/admin/service.ts,
 * which checks platform admin again before it creates the admin client.
 */

const uuid = z.guid()
const idFrom = (form: FormData, key: string) => uuid.safeParse(form.get(key))

// --- invites ---------------------------------------------------------------

const inviteForm = createPlatformInviteInput.extend({
  expiresInDays: z.coerce.number().pipe(createPlatformInviteInput.shape.expiresInDays),
})

export async function issuePlatformInvite(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const parsed = inviteForm.safeParse(formFields(form, ['email', 'note']))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await adminIssuePlatformInvite(ctx.supabase, parsed.data)
  if (!r.ok) {
    if (r.error.code === 'unique_violation') return failure('There is already an open invite for that email.', { email: 'Already invited.' })
    return fromDbError(r.error)
  }
  revalidatePath('/admin/users')
  return success('Invite created. Copy the link and share it. Nothing is emailed.', { url: inviteUrl(r.data.token) })
}

export async function revokePlatformInviteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'inviteId')
  if (!id.success) return failure('Pick an invite.')
  const r = await adminRevokePlatformInvite(ctx.supabase, { inviteId: id.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin/users')
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
  const r = await adminDismissAccessRequest(ctx.supabase, { requestId: id.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Request dismissed.')
}

export async function dismissWorkspaceRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const id = idFrom(form, 'requestId')
  if (!id.success) return failure('Pick a request.')
  const r = await adminDismissWorkspaceRequest(ctx.supabase, { requestId: id.data })
  if (!r.ok) return fromDbError(r.error)
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
  // The admin made themselves owner: the point was to build surveys, so go there.
  if (rest.ownerId === ctx.user.id) redirect(`/w/${encodeURIComponent(rest.slug)}/surveys/new?created=1`)
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

// --- direct membership (R20) -------------------------------------------------
// The admin_* functions check is_platform_admin(), refuse the owner role and
// write platform_audit_log; requirePlatformAdmin here is the UX guard.

const memberRole = z.enum(['admin', 'editor', 'viewer'])

async function addMember(workspaceId: unknown, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const ws = uuid.safeParse(workspaceId)
  const user = idFrom(form, 'userId')
  const role = memberRole.safeParse(form.get('role'))
  if (!ws.success) return failure('Pick a workspace.', { workspaceId: 'Required.' })
  if (!user.success) return failure('Pick a person.', { userId: 'Required.' })
  if (!role.success) return failure('Pick a role. Owner changes only through a transfer.', { role: 'Required.' })
  const r = await adminAddWorkspaceMember(ctx.supabase, { workspaceId: ws.data, userId: user.data, role: role.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Added to the workspace.')
}

/**
 * "Add me as admin" on the admin workspace list and detail page. Same
 * audited admin_add_workspace_member call as any other membership change
 * (rule 3: admins read workspace data only as members), then straight to
 * the workspace's surveys.
 */
export async function adminJoinWorkspaceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const ws = idFrom(form, 'workspaceId')
  if (!ws.success) return failure('Pick a workspace.')
  const r = await adminAddWorkspaceMember(ctx.supabase, { workspaceId: ws.data, userId: ctx.user.id, role: 'admin' })
  if (!r.ok) return fromDbError(r.error)
  const w = await getWorkspaceById(ctx.supabase, { workspaceId: ws.data })
  revalidatePath('/admin', 'layout')
  if (!w.ok || !w.data) return success('Added as admin.')
  redirect(`/w/${encodeURIComponent(w.data.slug)}/surveys`)
}

/** /admin/users: workspace id comes from the form. */
export async function adminAddMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return addMember(form.get('workspaceId'), form)
}

/** /admin/workspaces/[id]: bound to the workspace. */
export async function adminAddMemberToWorkspace(workspaceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return addMember(workspaceId, form)
}

export async function adminRemoveMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const ws = idFrom(form, 'workspaceId')
  const user = idFrom(form, 'userId')
  if (!ws.success || !user.success) return failure('Pick a membership.')
  const r = await adminRemoveWorkspaceMember(ctx.supabase, { workspaceId: ws.data, userId: user.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Removed. Surveys they owned now belong to the workspace owner.')
}

export async function adminSetMemberRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requirePlatformAdmin()
  const ws = idFrom(form, 'workspaceId')
  const user = idFrom(form, 'userId')
  const role = memberRole.safeParse(form.get('role'))
  if (!ws.success || !user.success) return failure('Pick a membership.')
  if (!role.success) return failure('Pick a role. Owner changes only through a transfer.')
  const r = await adminSetMemberRole(ctx.supabase, { workspaceId: ws.data, userId: user.data, role: role.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/admin', 'layout')
  return success('Role updated.')
}

// --- users -----------------------------------------------------------------

export async function mintResetLink(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin()
  const id = idFrom(form, 'userId')
  if (!id.success) return failure('Pick a user.')
  const r = await mintPasswordResetLink(id.data)
  // S6 (R18): self and platform admin targets are refused before any link exists.
  if (!r.ok) return r.error.code === 'not_authorized' ? failure(RESET_REFUSED_MESSAGE) : fromDbError(r.error)
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
  const parsed = updatePrivacyNoticeInput.safeParse({ markdown: String(form.get('markdown') ?? '') })
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await adminUpdatePrivacyNotice(ctx.supabase, { markdown: parsed.data.markdown })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/privacy')
  revalidatePath('/admin/settings')
  return success('Privacy notice saved. The public page shows it now.')
}
