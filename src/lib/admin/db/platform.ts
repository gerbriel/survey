import 'server-only'
import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from '@/lib/db/rpc'
import { affected, ilikePattern } from './shared'

/**
 * Platform admin table reads and writes under RLS (is_platform_admin()
 * policies, migrations 0002, 0003, 0010). Audit rows for these writes are
 * added by src/lib/admin/service.ts, since authenticated has no insert on
 * platform_audit_log.
 */
export type PlatformInvite = Tables<'platform_invites'>
export type PlatformSettings = Tables<'platform_settings'>
export type AbuseReport = Tables<'abuse_reports'>
export type PlatformAuditRow = Tables<'platform_audit_log'>
export type ProfileRow = Tables<'profiles'>
export type WorkspaceRow = Tables<'workspaces'>
export type WorkspaceLimitsRow = Tables<'workspace_limits'>

export const PAGE_SIZE = 50

// --- platform invites -------------------------------------------------------

export function listPlatformInvites(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.from('platform_invites').select('*').order('created_at', { ascending: false }).limit(300),
    (rows): PlatformInvite[] => rows ?? [],
  )
}

export const createPlatformInviteInput = z.object({
  invitedBy: id,
  email: z.email('Enter a valid email address.').trim().toLowerCase().max(320).nullable(),
  note: z.string().trim().max(200, 'Use 200 characters or fewer.').nullable(),
  expiresInDays: z.number().int().min(1).max(90),
})

export function createPlatformInvite(client: UserClient, input: z.input<typeof createPlatformInviteInput>) {
  return call(
    createPlatformInviteInput,
    input,
    (v) =>
      client
        .from('platform_invites')
        .insert({
          email: v.email,
          note: v.note,
          invited_by: v.invitedBy,
          expires_at: new Date(Date.now() + v.expiresInDays * 86_400_000).toISOString(),
        })
        .select('*')
        .single(),
    (row): PlatformInvite => row as PlatformInvite,
  )
}

export const inviteIdInput = z.object({ inviteId: id })

export function revokePlatformInvite(client: UserClient, input: z.input<typeof inviteIdInput>) {
  return call(
    inviteIdInput,
    input,
    (v) =>
      affected(
        client
          .from('platform_invites')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', v.inviteId)
          .is('revoked_at', null)
          .is('used_at', null)
          .select('id'),
      ),
    () => undefined,
  )
}

// --- platform settings (organization privacy notice) ------------------------

export function getPlatformSettings(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.from('platform_settings').select('*').eq('id', true).maybeSingle(),
    (row): PlatformSettings | null => row ?? null,
  )
}

export const PRIVACY_NOTICE_MAX = 50_000

export const updatePrivacyNoticeInput = z.object({
  updatedBy: id,
  markdown: z.string().max(PRIVACY_NOTICE_MAX, 'The notice is longer than 50,000 characters.'),
})

export function updatePrivacyNotice(client: UserClient, input: z.input<typeof updatePrivacyNoticeInput>) {
  return call(
    updatePrivacyNoticeInput,
    input,
    (v) =>
      affected(
        client
          .from('platform_settings')
          .update({ privacy_notice_md: v.markdown, updated_by: v.updatedBy })
          .eq('id', true)
          .select('id'),
      ),
    () => undefined,
  )
}

// --- abuse reports ----------------------------------------------------------

export const ABUSE_STATUSES = ['open', 'dismissed', 'actioned'] as const

export const listAbuseInput = z.object({ status: z.enum(ABUSE_STATUSES).default('open') })

export function listAbuseReports(client: UserClient, input: z.input<typeof listAbuseInput> = {}) {
  return call(
    listAbuseInput,
    input,
    (v) =>
      client.from('abuse_reports').select('*').eq('status', v.status).order('created_at', { ascending: false }).limit(200),
    (rows): AbuseReport[] => rows ?? [],
  )
}

export function countOpenAbuseReports(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () =>
      client
        .from('abuse_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .then((r) => ({ data: r.count, error: r.error })),
    (n): number => n ?? 0,
  )
}

export const setAbuseStatusInput = z.object({
  reportId: id,
  reviewerId: id,
  status: z.enum(['open', 'dismissed', 'actioned']),
})

export function setAbuseReportStatus(client: UserClient, input: z.input<typeof setAbuseStatusInput>) {
  return call(
    setAbuseStatusInput,
    input,
    (v) =>
      affected(
        client
          .from('abuse_reports')
          .update(
            v.status === 'open'
              ? { status: 'open', reviewed_by: null, reviewed_at: null }
              : { status: v.status, reviewed_by: v.reviewerId, reviewed_at: new Date().toISOString() },
          )
          .eq('id', v.reportId)
          .select('id'),
      ),
    () => undefined,
  )
}

// --- platform audit log -----------------------------------------------------

export const listAuditInput = z.object({
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: id.optional(),
  page: z.number().int().min(1).max(10_000).default(1),
})

export type AuditPage = { rows: PlatformAuditRow[]; total: number; page: number; pageSize: number }

export function listPlatformAudit(client: UserClient, input: z.input<typeof listAuditInput> = {}) {
  return call(
    listAuditInput,
    input,
    (v) => {
      let q = client.from('platform_audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false })
      if (v.action) q = q.ilike('action', ilikePattern(v.action))
      if (v.targetType) q = q.eq('target_type', v.targetType)
      if (v.targetId) q = q.eq('target_id', v.targetId)
      const start = (v.page - 1) * PAGE_SIZE
      return q.range(start, start + PAGE_SIZE - 1).then((r) => ({ data: { rows: r.data, count: r.count }, error: r.error }))
    },
    (d, v): AuditPage => ({ rows: d.rows ?? [], total: d.count ?? 0, page: v.page, pageSize: PAGE_SIZE }),
  )
}

// --- workspaces, limits, profiles (platform admin reads) --------------------

/** Every workspace including archived and deletion requested (workspaces_select allows platform admins). */
export function listAllWorkspaces(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.from('workspaces').select('*').order('name', { ascending: true }).limit(1000),
    (rows): WorkspaceRow[] => rows ?? [],
  )
}

export const workspaceIdInput = z.object({ workspaceId: id })

/** Includes deletion-requested workspaces, unlike getWorkspaceById callers expect. */
export function getAnyWorkspace(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.from('workspaces').select('*').eq('id', v.workspaceId).maybeSingle(),
    (row): WorkspaceRow | null => row ?? null,
  )
}

export function getWorkspaceLimitsRow(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.from('workspace_limits').select('*').eq('workspace_id', v.workspaceId).maybeSingle(),
    (row): WorkspaceLimitsRow | null => row ?? null,
  )
}

export const listProfilesInput = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['pending', 'active', 'disabled', 'deleted']).optional(),
})

export function listProfiles(client: UserClient, input: z.input<typeof listProfilesInput> = {}) {
  return call(
    listProfilesInput,
    input,
    (v) => {
      let q = client.from('profiles').select('*').order('display_name', { ascending: true }).limit(1000)
      if (v.status) q = q.eq('status', v.status)
      if (v.search) q = q.ilike('display_name', ilikePattern(v.search))
      return q
    },
    (rows): ProfileRow[] => rows ?? [],
  )
}

export const setProfileStatusInput = z.object({ userId: id, status: z.enum(['active', 'disabled']) })

/** Platform admin. guard_profile_privileges refuses disabling a workspace owner. */
export function setProfileStatus(client: UserClient, input: z.input<typeof setProfileStatusInput>) {
  return call(
    setProfileStatusInput,
    input,
    (v) => affected(client.from('profiles').update({ status: v.status }).eq('id', v.userId).select('id')),
    () => undefined,
  )
}
