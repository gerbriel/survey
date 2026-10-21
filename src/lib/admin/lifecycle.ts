/**
 * Workspace lifecycle timing (doc 05 sections 1.2 to 1.4), mirrored from the
 * guard_workspace_lifecycle trigger so the UI can say when an action becomes
 * available. Pure, unit tested. SQL is still what refuses an early request.
 */
const DAY = 24 * 60 * 60 * 1000

export const ARCHIVE_BEFORE_DELETE_DAYS = 7
export const RESTORE_WINDOW_DAYS = 30
export const SLUG_REDIRECT_DAYS = 30

export type LifecycleFields = { archived_at: string | null; deleted_at: string | null }

export type LifecycleState = 'active' | 'archived' | 'deletion_requested'

export function lifecycleState(ws: LifecycleFields): LifecycleState {
  if (ws.deleted_at) return 'deletion_requested'
  if (ws.archived_at) return 'archived'
  return 'active'
}

function plusDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * DAY)
}

/** When deletion may be requested, or null when the workspace is not archived. */
export function deletionAvailableAt(ws: LifecycleFields): Date | null {
  return ws.archived_at && !ws.deleted_at ? plusDays(ws.archived_at, ARCHIVE_BEFORE_DELETE_DAYS) : null
}

export function canRequestDeletion(ws: LifecycleFields, now: Date = new Date()): boolean {
  const at = deletionAvailableAt(ws)
  return at !== null && at.getTime() <= now.getTime()
}

/** When the hard delete becomes due (end of the restore window), or null. */
export function purgeDueAt(ws: LifecycleFields): Date | null {
  return ws.deleted_at ? plusDays(ws.deleted_at, RESTORE_WINDOW_DAYS) : null
}

export function canRestore(ws: LifecycleFields, now: Date = new Date()): boolean {
  const at = purgeDueAt(ws)
  return at !== null && at.getTime() > now.getTime()
}

/** An old workspace slug still redirects when released less than 30 days ago. */
export function slugRedirectActive(releasedAt: string, now: Date = new Date()): boolean {
  return plusDays(releasedAt, SLUG_REDIRECT_DAYS).getTime() > now.getTime()
}

/** "Oct 21, 2026" style, fixed locale and UTC so server and client agree. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`
}

/** Bytes as "1.2 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 10 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

/** Invite status from its columns (workspace and platform invites share the idea). */
export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'

export function inviteStatus(
  inv: { revoked_at: string | null; expires_at: string; used_count?: number; max_uses?: number; used_at?: string | null },
  now: Date = new Date(),
): InviteStatus {
  if (inv.revoked_at) return 'revoked'
  if (inv.used_at) return 'used'
  if (inv.max_uses !== undefined && inv.used_count !== undefined && inv.used_count >= inv.max_uses) return 'used'
  if (new Date(inv.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'open'
}
