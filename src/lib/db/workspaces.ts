import { z } from 'zod'
import type { Tables, WorkspaceRole } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient } from '@/lib/supabase/types'
import { affected, call, id, jsonObject, workspaceRole, workspaceSlug } from './rpc'

export { workspaceSlug }

/**
 * Workspace reads and lifecycle functions (migration 0003, doc 05 section 1).
 * Admin-only functions (create, limits, restore, purge) live in admin.ts.
 */
export type Workspace = Tables<'workspaces'>

export type MembershipSummary = {
  role: WorkspaceRole
  workspace: Pick<Workspace, 'id' | 'name' | 'slug' | 'logo_path' | 'archived_at'>
}

export const getWorkspaceBySlugInput = z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) })

/** RLS returns the row only to members and platform admins; null otherwise. */
export function getWorkspaceBySlug(client: UserClient, input: z.input<typeof getWorkspaceBySlugInput>) {
  return call(
    getWorkspaceBySlugInput,
    input,
    (v) => client.from('workspaces').select('*').eq('slug', v.slug).is('deleted_at', null).maybeSingle(),
    (row): Workspace | null => row ?? null,
  )
}

export const workspaceIdInput = z.object({ workspaceId: id })

export function getWorkspaceById(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.from('workspaces').select('*').eq('id', v.workspaceId).maybeSingle(),
    (row): Workspace | null => row ?? null,
  )
}

export const getMembershipInput = z.object({ workspaceId: id, userId: id })

/** The caller's role in a workspace, or null when not a member. */
export function getMembership(client: UserClient, input: z.input<typeof getMembershipInput>) {
  return call(
    getMembershipInput,
    input,
    (v) =>
      client
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', v.workspaceId)
        .eq('user_id', v.userId)
        .maybeSingle(),
    (row): WorkspaceRole | null => row?.role ?? null,
  )
}

export const listMembershipsInput = z.object({ userId: id })

/** Every workspace the user belongs to, for the switcher. Sorted by name. */
export function listMemberships(client: UserClient, input: z.input<typeof listMembershipsInput>) {
  return call(
    listMembershipsInput,
    input,
    (v) =>
      client
        .from('workspace_members')
        .select('role, workspace:workspaces!inner(id, name, slug, logo_path, archived_at)')
        .eq('user_id', v.userId),
    (rows): MembershipSummary[] =>
      (rows ?? [])
        .map((r) => ({ role: r.role, workspace: r.workspace }))
        .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name)),
  )
}

export const isMemberInput = z.object({ workspaceId: id, minRole: workspaceRole.default('viewer') })

/** SQL is_member(workspace_id, min_role): the same check every policy uses. */
export function isMember(client: UserClient, input: z.input<typeof isMemberInput>) {
  return call(
    isMemberInput,
    input,
    (v) => client.rpc('is_member', { p_workspace_id: v.workspaceId, p_min_role: v.minRole }),
    (d): boolean => d === true,
  )
}

export const slugAvailableInput = z.object({ slug: workspaceSlug, workspaceId: id.optional() })

export function isWorkspaceSlugAvailable(client: UserOrAdminClient, input: z.input<typeof slugAvailableInput>) {
  return call(
    slugAvailableInput,
    input,
    (v) =>
      client.rpc('workspace_slug_available', {
        p_slug: v.slug,
        ...(v.workspaceId ? { p_workspace_id: v.workspaceId } : {}),
      }),
    (d): boolean => d === true,
  )
}

export const transferOwnershipInput = z.object({ workspaceId: id, newOwnerId: id })

/** Owner, or a platform admin (forced transfer). The old owner becomes admin. */
export function transferWorkspaceOwnership(client: UserClient, input: z.input<typeof transferOwnershipInput>) {
  return call(
    transferOwnershipInput,
    input,
    (v) => client.rpc('transfer_workspace_ownership', { p_workspace_id: v.workspaceId, p_new_owner: v.newOwnerId }),
    () => undefined,
  )
}

export const renameSlugInput = z.object({ workspaceId: id, slug: workspaceSlug })

/** Admin. The old slug redirects for 30 days (workspace_slug_history). */
export function renameWorkspaceSlug(client: UserClient, input: z.input<typeof renameSlugInput>) {
  return call(
    renameSlugInput,
    input,
    (v) => client.rpc('rename_workspace_slug', { p_workspace_id: v.workspaceId, p_slug: v.slug }),
    () => undefined,
  )
}

/** Owner or platform admin. Raises invalid_state when already archived. */
export function archiveWorkspace(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('archive_workspace', { p_workspace_id: v.workspaceId }),
    () => undefined,
  )
}

export function unarchiveWorkspace(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('unarchive_workspace', { p_workspace_id: v.workspaceId }),
    () => undefined,
  )
}

export const requestDeletionInput = z.object({ workspaceId: id, confirmSlug: z.string().trim().min(1) })

/** Owner or platform admin, after 7 days archived. Restorable for 30 days. */
export function requestWorkspaceDeletion(client: UserClient, input: z.input<typeof requestDeletionInput>) {
  return call(
    requestDeletionInput,
    input,
    (v) =>
      client.rpc('request_workspace_deletion', { p_workspace_id: v.workspaceId, p_confirm_slug: v.confirmSlug }),
    () => undefined,
  )
}

// ---------------------------------------------------------------------------
// Settings writes under RLS (workspaces_update: admin; doc 05 section 5).
// ---------------------------------------------------------------------------

export const updateGeneralInput = z.object({
  workspaceId: id,
  name: z.string().trim().min(1, 'Enter a name.').max(80, 'Use 80 characters or fewer.'),
  showPoweredBy: z.boolean(),
  defaultTheme: jsonObject,
})

export function updateWorkspaceGeneral(client: UserClient, input: z.input<typeof updateGeneralInput>) {
  return call(
    updateGeneralInput,
    input,
    (v) =>
      affected(
        client
          .from('workspaces')
          .update({
            name: v.name,
            show_powered_by: v.showPoweredBy,
            default_theme: v.defaultTheme as Tables<'workspaces'>['default_theme'],
          })
          .eq('id', v.workspaceId)
          .select('id'),
      ),
    () => undefined,
  )
}

export const PIXEL_CONSENT_MODES = ['banner', 'notice', 'in_form'] as const

export const updatePrivacyInput = z.object({
  workspaceId: id,
  storeIp: z.boolean(),
  retentionDays: z.number().int().min(30, 'Keep at least 30 days.').max(3650, 'Use 3650 days or fewer.').nullable(),
  defaultCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two letter country code, for example US.'),
  privacyNoticeUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((s) => /^https:\/\/[^\s]+$/i.test(s), 'Use an https:// address.')
    .nullable(),
  consentDefaultText: z.string().trim().max(2000, 'Use 2000 characters or fewer.').nullable(),
  pixelConsentMode: z.enum(PIXEL_CONSENT_MODES),
  /** Required when switching to notice; the trigger stamps who. */
  acknowledgeNotice: z.boolean(),
})

/** Decision: switching to `notice` requires the acknowledgment every time it is selected anew. */
export function updateWorkspacePrivacy(
  client: UserClient,
  input: z.input<typeof updatePrivacyInput>,
  current: { pixel_consent_mode: string; pixel_notice_ack_at: string | null },
) {
  return call(
    updatePrivacyInput,
    input,
    (v) => {
      const patch: Partial<Tables<'workspaces'>> = {
        store_ip: v.storeIp,
        retention_days: v.retentionDays,
        default_country: v.defaultCountry,
        privacy_notice_url: v.privacyNoticeUrl,
        consent_default_text: v.consentDefaultText,
        pixel_consent_mode: v.pixelConsentMode,
      }
      if (v.pixelConsentMode === 'notice' && (current.pixel_consent_mode !== 'notice' || !current.pixel_notice_ack_at)) {
        if (!v.acknowledgeNotice) {
          return Promise.resolve({ data: null, error: { message: 'invalid_state' } })
        }
        patch.pixel_notice_ack_at = new Date().toISOString()
      }
      return affected(client.from('workspaces').update(patch).eq('id', v.workspaceId).select('id'))
    },
    () => undefined,
  )
}

export const setLogoInput = z.object({ workspaceId: id, logoPath: z.string().max(300).nullable() })

export function setWorkspaceLogoPath(client: UserClient, input: z.input<typeof setLogoInput>) {
  return call(
    setLogoInput,
    input,
    (v) => affected(client.from('workspaces').update({ logo_path: v.logoPath }).eq('id', v.workspaceId).select('id')),
    () => undefined,
  )
}

export const LOGO_BUCKET = 'public-assets'

export const uploadLogoInput = z.object({
  workspaceId: id,
  path: z.string().regex(/^[0-9a-f-]{36}\/logo-[a-f0-9]{16}\.(png|jpg|webp)$/),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.instanceof(Uint8Array),
})

/** Storage write under storage.objects RLS: a top-level logo needs admin (migration 0008). */
export function uploadLogoObject(client: UserClient, input: z.input<typeof uploadLogoInput>) {
  return call(
    uploadLogoInput,
    input,
    (v) =>
      client.storage
        .from(LOGO_BUCKET)
        .upload(v.path, v.bytes, { contentType: v.contentType, upsert: true, cacheControl: '31536000' }),
    () => undefined,
  )
}

export const removeLogoInput = z.object({ path: z.string().min(1).max(300) })

export function removeLogoObject(client: UserClient, input: z.input<typeof removeLogoInput>) {
  return call(removeLogoInput, input, (v) => client.storage.from(LOGO_BUCKET).remove([v.path]), () => undefined)
}

/** Public URL of a public-assets path, for <img>. Pure string work on the client. */
export function logoPublicUrl(client: UserClient, path: string | null): string | null {
  if (!path) return null
  return client.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl
}

export const slugHistoryInput = z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) })

export type SlugHistoryRow = { workspace_id: string | null; released_at: string }

/** Old slug lookup for the 30 day redirect. RLS returns it only to members of the workspace. */
export function getSlugHistory(client: UserClient, input: z.input<typeof slugHistoryInput>) {
  return call(
    slugHistoryInput,
    input,
    (v) => client.from('workspace_slug_history').select('workspace_id, released_at').eq('slug', v.slug).maybeSingle(),
    (row): SlugHistoryRow | null => row ?? null,
  )
}

// ---------------------------------------------------------------------------
// Members (doc 05 section 2). Reads: every member (workspace_members_select).
// Role changes and removal: admin under RLS, with guard_workspace_member
// enforcing the owner-only cases. Ownership moves only through
// transferWorkspaceOwnership above.
// ---------------------------------------------------------------------------

export type MemberRow = {
  user_id: string
  role: WorkspaceRole
  created_at: string
  invite_id: string | null
  display_name: string
  avatar_url: string | null
  status: string | null
}

/** Name and role only, for pickers (owner, filters). */
export type MemberLite = Pick<MemberRow, 'user_id' | 'role' | 'display_name'>

/** Every member with profile name, sorted by name. Emails need listMembersWithEmail. */
export function listMembers(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      client
        .from('workspace_members')
        .select(
          'user_id, role, created_at, invite_id, profile:profiles!workspace_members_user_id_fkey(display_name, avatar_url, status)',
        )
        .eq('workspace_id', v.workspaceId),
    (rows): MemberRow[] =>
      (rows ?? [])
        .map((r) => {
          const p = r.profile as { display_name: string; avatar_url: string | null; status: string } | null
          return {
            user_id: r.user_id,
            role: r.role,
            created_at: r.created_at,
            invite_id: r.invite_id,
            display_name: p?.display_name ?? 'Unknown user',
            avatar_url: p?.avatar_url ?? null,
            status: p?.status ?? null,
          }
        })
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  )
}

export type MemberWithEmail = MemberRow & { email: string | null }

/** Admin and owner (workspace_members_with_email, migration 0018). Same shape as listMembers plus email. */
export function listMembersWithEmail(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('workspace_members_with_email', { p_workspace_id: v.workspaceId }),
    (rows): MemberWithEmail[] =>
      (rows ?? [])
        .map((r) => ({
          user_id: r.user_id,
          role: r.role,
          created_at: r.joined_at,
          invite_id: r.invite_id ?? null,
          display_name: r.display_name ?? 'Unknown user',
          avatar_url: r.avatar_url ?? null,
          status: r.status ?? null,
          email: r.email ?? null,
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  )
}

export const changeRoleInput = z.object({
  workspaceId: id,
  userId: id,
  role: workspaceRole.exclude(['owner']),
})

export function changeMemberRole(client: UserClient, input: z.input<typeof changeRoleInput>) {
  return call(
    changeRoleInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_members')
          .update({ role: v.role })
          .eq('workspace_id', v.workspaceId)
          .eq('user_id', v.userId)
          .select('user_id'),
      ),
    () => undefined,
  )
}

export const removeMemberInput = z.object({ workspaceId: id, userId: id })

/** Admin removes editors and viewers, owner removes anyone else, anyone but the owner may leave. */
export function removeMember(client: UserClient, input: z.input<typeof removeMemberInput>) {
  return call(
    removeMemberInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_members')
          .delete()
          .eq('workspace_id', v.workspaceId)
          .eq('user_id', v.userId)
          .select('user_id'),
      ),
    () => undefined,
  )
}

// ---------------------------------------------------------------------------
// Activity log viewer (doc 05 section 5.7). RLS: admin and owner read.
// ---------------------------------------------------------------------------

export type ActivityRow = Tables<'activity_log'>

/** Entity names written by log_activity() and write_activity() (migration 0003 and later). */
export const ACTIVITY_ENTITIES = [
  'survey',
  'survey_version',
  'alias',
  'template',
  'contact',
  'contact_field',
  'member',
  'invite',
  'workspace',
  'pixel',
  'limits',
  'report',
  'share',
  'export',
  'import',
] as const

export const ACTIVITY_PAGE_SIZE = 50

export const listActivityInput = z.object({
  workspaceId: id,
  entity: z.string().trim().max(40).optional(),
  actor: id.optional(),
  action: z.string().trim().max(60).optional(),
  entityId: id.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
})

export type ActivityPage = { rows: ActivityRow[]; total: number; page: number; pageSize: number }

export function listActivity(client: UserClient, input: z.input<typeof listActivityInput>) {
  return call(
    listActivityInput,
    input,
    (v) => {
      let q = client
        .from('activity_log')
        .select('*', { count: 'exact' })
        .eq('workspace_id', v.workspaceId)
        .order('created_at', { ascending: false })
      if (v.entity) q = q.eq('entity', v.entity)
      if (v.actor) q = q.eq('actor', v.actor)
      if (v.action) q = q.eq('action', v.action)
      if (v.entityId) q = q.eq('entity_id', v.entityId)
      if (v.from) q = q.gte('created_at', `${v.from}T00:00:00Z`)
      if (v.to) q = q.lt('created_at', new Date(new Date(`${v.to}T00:00:00Z`).getTime() + 86_400_000).toISOString())
      const start = (v.page - 1) * ACTIVITY_PAGE_SIZE
      return q.range(start, start + ACTIVITY_PAGE_SIZE - 1).then((r) => ({ data: { rows: r.data, count: r.count }, error: r.error }))
    },
    (d, v): ActivityPage => ({ rows: d.rows ?? [], total: d.count ?? 0, page: v.page, pageSize: ACTIVITY_PAGE_SIZE }),
  )
}
