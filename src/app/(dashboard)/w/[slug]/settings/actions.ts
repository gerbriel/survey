'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireMember } from '@/lib/auth'
import { inviteUrl } from '@/lib/admin/links'
import {
  archiveWorkspace,
  renameWorkspaceSlug,
  requestWorkspaceDeletion,
  transferWorkspaceOwnership,
  unarchiveWorkspace,
} from '@/lib/db/workspaces'
import { workspaceSlug } from '@/lib/db/rpc'
import { changeMemberRole, removeMember } from '@/lib/admin/db/members'
import { createInviteInput, createWorkspaceInvite, revokeWorkspaceInvite } from '@/lib/admin/db/invites'
import { createPixel, deletePixel, updatePixel } from '@/lib/admin/db/pixels'
import {
  removeLogoObject,
  setWorkspaceLogoPath,
  updatePrivacyInput,
  updateWorkspaceGeneral,
  updateWorkspacePrivacy,
} from '@/lib/admin/db/workspace'
import {
  failure,
  formBool,
  formFields,
  fromDbError,
  fromZodError,
  success,
  type ActionState,
} from '@/lib/admin/forms'
import { isRawScriptType, parseCustomScript, pixelValueError, PIXEL_TYPES } from '@/lib/admin/pixels'
import { getEffectiveLimits } from '@/lib/db/limits'

/**
 * Workspace settings mutations (doc 05 section 5). Each action re-checks the
 * role with requireMember for UX (a clean redirect), validates with zod, and
 * calls one wrapper. RLS and the SQL guards are the authorization; their
 * DbError codes come back as readable messages through fromDbError.
 * Every action is bound to the workspace slug by the page that renders it.
 */

const base = (slug: string) => `/w/${encodeURIComponent(slug)}/settings`
const DEFAULT_THEME_MAX = 20_000

// --- General ---------------------------------------------------------------

const generalForm = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(80, 'Use 80 characters or fewer.'),
  slug: workspaceSlug.refine((s) => s.length > 0, 'Enter an address.'),
  defaultTheme: z.string().max(DEFAULT_THEME_MAX, 'The theme JSON is too long.'),
})

/** Parses the default theme editor value: blank means {}, otherwise a JSON object. */
function parseTheme(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (!text.trim()) return { ok: true, value: {} }
  try {
    const v: unknown = JSON.parse(text)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, message: 'The theme must be a JSON object.' }
    return { ok: true, value: v as Record<string, unknown> }
  } catch {
    return { ok: false, message: 'The theme is not valid JSON.' }
  }
}

export async function updateGeneral(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const parsed = generalForm.safeParse(formFields(form))
  if (!parsed.success) {
    const st = fromZodError(parsed.error)
    if (st.fieldErrors?.slug) st.fieldErrors.slug = 'Use 3 to 40 lowercase letters, numbers and single hyphens.'
    return st
  }
  const theme = parseTheme(parsed.data.defaultTheme)
  if (!theme.ok) return failure(theme.message, { defaultTheme: theme.message })

  const r = await updateWorkspaceGeneral(supabase, {
    workspaceId: workspace.id,
    name: parsed.data.name,
    showPoweredBy: formBool(form, 'showPoweredBy'),
    defaultTheme: theme.value,
  })
  if (!r.ok) return fromDbError(r.error)

  if (parsed.data.slug !== workspace.slug) {
    const s = await renameWorkspaceSlug(supabase, { workspaceId: workspace.id, slug: parsed.data.slug })
    if (!s.ok) {
      const st = fromDbError(s.error)
      return { ...st, fieldErrors: { slug: st.message ?? '' } }
    }
    revalidatePath('/', 'layout')
    redirect(`${base(parsed.data.slug)}/general?renamed=1`)
  }
  revalidatePath(`/w/${slug}`, 'layout')
  return success('Settings saved.')
}

export async function removeLogo(slug: string): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  if (!workspace.logo_path) return success('No logo to remove.')
  const r = await setWorkspaceLogoPath(supabase, { workspaceId: workspace.id, logoPath: null })
  if (!r.ok) return fromDbError(r.error)
  await removeLogoObject(supabase, { path: workspace.logo_path })
  revalidatePath(`/w/${slug}`, 'layout')
  return success('Logo removed.')
}

export async function archive(slug: string): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'viewer')
  const r = await archiveWorkspace(supabase, { workspaceId: workspace.id })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`/w/${slug}`, 'layout')
  return success('Workspace archived. Everything is now read only.')
}

export async function unarchive(slug: string): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'viewer')
  const r = await unarchiveWorkspace(supabase, { workspaceId: workspace.id })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`/w/${slug}`, 'layout')
  return success('Workspace restored from the archive.')
}

export async function requestDeletion(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'viewer')
  const confirmSlug = String(form.get('confirmSlug') ?? '').trim()
  if (!confirmSlug) return failure('Type the workspace address to confirm.', { confirmSlug: 'Required.' })
  const r = await requestWorkspaceDeletion(supabase, { workspaceId: workspace.id, confirmSlug })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath('/', 'layout')
  redirect('/')
}

// --- Members ---------------------------------------------------------------

const memberForm = z.object({ userId: z.guid() })

export async function changeRole(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const parsed = memberForm.extend({ role: z.enum(['admin', 'editor', 'viewer']) }).safeParse(formFields(form))
  if (!parsed.success) return fromZodError(parsed.error, 'Pick a role.')
  const r = await changeMemberRole(supabase, { workspaceId: workspace.id, ...parsed.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/members`)
  return success('Role updated.')
}

export async function removeMemberAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace, user } = await requireMember(slug, 'viewer')
  const parsed = memberForm.safeParse(formFields(form))
  if (!parsed.success) return failure('Pick a member.')
  const r = await removeMember(supabase, { workspaceId: workspace.id, userId: parsed.data.userId })
  if (!r.ok) return fromDbError(r.error)
  if (parsed.data.userId === user.id) {
    revalidatePath('/', 'layout')
    redirect('/')
  }
  revalidatePath(`${base(slug)}/members`)
  return success('Member removed. Everything they created stays.')
}

export async function transferOwnership(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'viewer')
  const parsed = memberForm.safeParse(formFields(form))
  if (!parsed.success) return failure('Pick the new owner.')
  const r = await transferWorkspaceOwnership(supabase, { workspaceId: workspace.id, newOwnerId: parsed.data.userId })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`/w/${slug}`, 'layout')
  return success('Ownership transferred. You are now an admin.')
}

// --- Invites ---------------------------------------------------------------

const inviteForm = createInviteInput.omit({ workspaceId: true }).extend({
  expiresInDays: z.coerce.number().pipe(createInviteInput.shape.expiresInDays),
  maxUses: z.coerce.number().pipe(createInviteInput.shape.maxUses),
})

export async function createInvite(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const parsed = inviteForm.safeParse(formFields(form, ['label']))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await createWorkspaceInvite(supabase, { workspaceId: workspace.id, ...parsed.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/invites`)
  return success('Invite link created. Copy it and share it however you like. Nothing is emailed.', {
    url: inviteUrl(r.data.token),
  })
}

export async function revokeInvite(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const inviteId = z.guid().safeParse(form.get('inviteId'))
  if (!inviteId.success) return failure('Pick an invite.')
  const r = await revokeWorkspaceInvite(supabase, { workspaceId: workspace.id, inviteId: inviteId.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/invites`)
  return success('Invite revoked.')
}

// --- Tracking pixels -------------------------------------------------------

const pixelForm = z.object({
  pixelId: z.guid().nullable(),
  type: z.enum(PIXEL_TYPES, 'Pick a type.'),
  value: z.string().trim().min(1, 'Enter the ID or script.').max(10_000, 'Use 10,000 characters or fewer.'),
  label: z.string().trim().min(1, 'Add a label.').max(80, 'Use 80 characters or fewer.'),
})

export async function savePixel(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const parsed = pixelForm.safeParse(formFields(form, ['pixelId']))
  if (!parsed.success) return fromZodError(parsed.error)
  const { pixelId, type, label } = parsed.data
  const value = type === 'custom_script' ? String(form.get('value') ?? '') : parsed.data.value
  const enabled = formBool(form, 'enabled')

  const valueError = pixelValueError(type, value)
  if (valueError) return failure(valueError, { value: valueError })
  if (isRawScriptType(type) && enabled) {
    const limits = await getEffectiveLimits(supabase, { workspaceId: workspace.id })
    if (limits.ok && limits.data && !limits.data.raw_script_pixels_allowed) {
      return failure('Script pixels are turned off for this workspace by a platform admin.')
    }
  }
  const parsedScript = type === 'custom_script' ? parseCustomScript(value) : null
  const payload = {
    workspaceId: workspace.id,
    type,
    value,
    label,
    enabled,
    parsed: parsedScript && parsedScript.ok ? parsedScript.parsed : null,
  }
  const r = pixelId ? await updatePixel(supabase, { ...payload, pixelId }) : await createPixel(supabase, payload)
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/pixels`)
  return success(pixelId ? 'Pixel saved.' : 'Pixel added.')
}

export async function removePixel(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const pixelId = z.guid().safeParse(form.get('pixelId'))
  if (!pixelId.success) return failure('Pick a pixel.')
  const r = await deletePixel(supabase, { workspaceId: workspace.id, pixelId: pixelId.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/pixels`)
  return success('Pixel deleted.')
}

// --- Privacy ---------------------------------------------------------------

const privacyForm = updatePrivacyInput.omit({ workspaceId: true, storeIp: true, acknowledgeNotice: true }).extend({
  retentionDays: z.union([z.null(), z.coerce.number().pipe(updatePrivacyInput.shape.retentionDays.unwrap())]),
})

export async function updatePrivacy(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await requireMember(slug, 'admin')
  const fields = formFields(form, ['retentionDays', 'privacyNoticeUrl', 'consentDefaultText'])
  if (form.get('retentionMode') === 'forever') fields.retentionDays = null
  const parsed = privacyForm.safeParse(fields)
  if (!parsed.success) return fromZodError(parsed.error)
  const acknowledgeNotice = formBool(form, 'acknowledgeNotice')
  const switchingToNotice =
    parsed.data.pixelConsentMode === 'notice' &&
    (workspace.pixel_consent_mode !== 'notice' || !workspace.pixel_notice_ack_at)
  if (switchingToNotice && !acknowledgeNotice) {
    return failure('Tick the acknowledgment to use notice mode.', {
      acknowledgeNotice: 'Required for notice mode.',
    })
  }
  const r = await updateWorkspacePrivacy(
    supabase,
    { workspaceId: workspace.id, storeIp: formBool(form, 'storeIp'), acknowledgeNotice, ...parsed.data },
    workspace,
  )
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(`${base(slug)}/privacy`)
  return success('Privacy settings saved.')
}
