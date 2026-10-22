import type { WorkspaceRole } from '@/types/db-helpers'

/**
 * Who may do what to a member row (doc 05 section 2.2), mirrored from
 * guard_workspace_member for the UI. Pure, unit tested. UX only: the
 * trigger and RLS refuse anything this lets through by mistake.
 */
export function assignableRoles(actor: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  if (target === 'owner') return []
  if (actor === 'owner') return ['admin', 'editor', 'viewer']
  if (actor === 'admin' && target !== 'admin') return ['editor', 'viewer']
  return []
}

export function canRemove(actor: WorkspaceRole, target: WorkspaceRole, isSelf: boolean): boolean {
  if (target === 'owner') return false
  if (isSelf) return true // anyone but the owner may leave
  if (actor === 'owner') return true
  return actor === 'admin' && target !== 'admin'
}

/** Roles an inviter may offer on a link (doc 05 section 3.2). */
export function invitableRoles(actor: WorkspaceRole): Array<'admin' | 'editor' | 'viewer'> {
  if (actor === 'owner') return ['admin', 'editor', 'viewer']
  if (actor === 'admin') return ['editor', 'viewer']
  return []
}

/**
 * Roles the owner or an admin may give when adding an existing user directly
 * (R20, add_workspace_member): at or below their own role, never owner. So
 * an admin may add another admin here, unlike invite links.
 */
export function directAddRoles(actor: WorkspaceRole): Array<'admin' | 'editor' | 'viewer'> {
  if (actor === 'owner' || actor === 'admin') return ['admin', 'editor', 'viewer']
  return []
}
