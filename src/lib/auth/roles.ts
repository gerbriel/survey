import type { WorkspaceRole } from '@/types/db-helpers'

/**
 * Role ordering, mirroring SQL is_member(workspace_id, min_role) in
 * migration 0003: viewer < editor < admin < owner (enum order), and an
 * archived workspace is read only, so only a viewer-level check passes there.
 *
 * UX only. The UI uses this to hide buttons and pick redirects; RLS and the
 * SQL functions are what actually refuse a request.
 */
export const ROLE_ORDER = ['viewer', 'editor', 'admin', 'owner'] as const satisfies readonly WorkspaceRole[]

export function roleRank(role: WorkspaceRole): number {
  return ROLE_ORDER.indexOf(role)
}

/** True when `role` is `min` or above. */
export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  if (!role) return false
  return roleRank(role) >= roleRank(min)
}

/** Sort comparator, highest role first. */
export function compareRolesDesc(a: WorkspaceRole, b: WorkspaceRole): number {
  return roleRank(b) - roleRank(a)
}

/**
 * Same answer is_member would give for this membership: the role reaches
 * `min`, and an archived workspace only allows `viewer` checks. Profile status
 * (active) and deletion are checked by the caller before this.
 */
export function memberCan(
  role: WorkspaceRole | null | undefined,
  min: WorkspaceRole,
  workspace: { archived_at: string | null },
): boolean {
  if (!roleAtLeast(role, min)) return false
  return workspace.archived_at === null || min === 'viewer'
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (ROLE_ORDER as readonly string[]).includes(value)
}
