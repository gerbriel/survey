import { z } from 'zod'
import type { Tables, WorkspaceRole } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient } from '@/lib/supabase/types'
import { call, id, workspaceRole, workspaceSlug } from './rpc'

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
