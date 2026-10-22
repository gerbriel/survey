import { z } from 'zod'
import type { Json, Tables, WorkspaceRole } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient, AdminClient } from '@/lib/supabase/types'
import { affected, asJson, call, id, ilikePattern, workspaceRole, workspaceSlug, type StorageDeletion } from './rpc'

/**
 * Platform admin functions (migrations 0003, 0006, 0015; doc 05 section 6).
 * SQL checks is_platform_admin() (or the service role where noted) and
 * writes platform_audit_log. Minting a password reset link uses the Auth
 * admin API, not SQL, and belongs to Phase 2A.
 */

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: workspaceSlug,
  ownerId: id,
  requestId: id.optional(),
})

/** Platform admin or service role. A pending owner is activated. Returns the workspace id. */
export function adminCreateWorkspace(client: UserOrAdminClient, input: z.input<typeof createWorkspaceInput>) {
  return call(
    createWorkspaceInput,
    input,
    (v) =>
      client.rpc('admin_create_workspace', {
        p_name: v.name,
        p_slug: v.slug,
        p_owner: v.ownerId,
        ...(v.requestId ? { p_request_id: v.requestId } : {}),
      }),
    (d): string => d as string,
  )
}

/** Override columns of workspace_limits. Omitted or null means "use the global default". */
export const limitOverrides = z.strictObject({
  max_file_bytes: z.number().int().positive().nullable().optional(),
  max_files_per_response: z.number().int().positive().nullable().optional(),
  max_questions: z.number().int().positive().nullable().optional(),
  max_definition_bytes: z.number().int().positive().nullable().optional(),
  rate_limit_per_hour: z.number().int().positive().nullable().optional(),
  raw_script_pixels_allowed: z.boolean().nullable().optional(),
})

export const setLimitsInput = z.object({
  workspaceId: id,
  /** Replaces every override: keys left out are reset to the default. */
  limits: limitOverrides,
  note: z.string().trim().min(1).max(2000),
})

export function adminSetWorkspaceLimits(client: UserClient, input: z.input<typeof setLimitsInput>) {
  return call(
    setLimitsInput,
    input,
    (v) =>
      client.rpc('admin_set_workspace_limits', {
        p_workspace_id: v.workspaceId,
        p_limits: asJson(v.limits),
        p_note: v.note,
      }),
    () => undefined,
  )
}

export const closeSurveyInput = z.object({ surveyId: id, reason: z.string().trim().min(1).max(1000) })

/** Sets admin_closed_at; survey state is untouched. Logged in both audit logs. */
export function adminCloseSurvey(client: UserClient, input: z.input<typeof closeSurveyInput>) {
  return call(
    closeSurveyInput,
    input,
    (v) => client.rpc('admin_close_survey', { p_survey_id: v.surveyId, p_reason: v.reason }),
    () => undefined,
  )
}

export const requestIdInput = z.object({ requestId: id })

/** Creates a claimed platform invite for the requester and activates them. */
export function adminApproveAccessRequest(client: UserClient, input: z.input<typeof requestIdInput>) {
  return call(
    requestIdInput,
    input,
    (v) => client.rpc('admin_approve_access_request', { p_request_id: v.requestId }),
    () => undefined,
  )
}

export const workspaceIdInput = z.object({ workspaceId: id })

/** Undo a deletion request within the 30 day window. Platform admin only. */
export function restoreWorkspace(client: UserClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('restore_workspace', { p_workspace_id: v.workspaceId }),
    () => undefined,
  )
}

export type WorkspaceStorageUsage = { workspace_id: string; name: string; slug: string; bytes: number }

/** Bytes per workspace from storage.objects. Platform admin only. */
export function platformStorageUsage(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.rpc('platform_storage_usage'),
    (rows): WorkspaceStorageUsage[] => (rows ?? []) as WorkspaceStorageUsage[],
  )
}

export const purgeDueInput = z.object({ limit: z.number().int().min(1).max(100).default(10) })

/** Service role (workspace-purge cron): workspaces past the 30 day restore window. */
export function workspacePurgeDue(client: AdminClient, input: z.input<typeof purgeDueInput> = {}) {
  return call(
    purgeDueInput,
    input,
    (v) => client.rpc('workspace_purge_due', { p_limit: v.limit }),
    (rows): string[] => (rows ?? []) as string[],
  )
}

export type PurgeCounts = { surveys: number; responses: number; contacts: number; bytes: number }

/** Service role. Hard delete; returns the counts written to the platform audit log. */
export function purgeWorkspace(client: AdminClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('purge_workspace', { p_workspace_id: v.workspaceId }),
    (d): PurgeCounts => d as unknown as PurgeCounts,
  )
}

/**
 * Service role (workspace-purge cron, migration 0018): the undone
 * storage_deletions of one workspace, including after purge_workspace removed
 * the row. At most 1000 per call.
 */
export function pendingStorageDeletions(client: AdminClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) => client.rpc('pending_storage_deletions', { p_workspace_id: v.workspaceId }),
    (rows): StorageDeletion[] => (rows ?? []) as StorageDeletion[],
  )
}

// ---------------------------------------------------------------------------
// Platform admin reads and writes (doc 05 section 6). Reads are table queries
// under the is_platform_admin() RLS policies; writes go through the
// self-auditing admin_* functions of migration 0018, so no platform_audit_log
// row is ever inserted from TypeScript except for Auth admin API actions.
// ---------------------------------------------------------------------------

export type PlatformInvite = Tables<'platform_invites'>
export type PlatformSettings = Tables<'platform_settings'>
export type AbuseReport = Tables<'abuse_reports'>
export type PlatformAuditRow = Tables<'platform_audit_log'>
export type ProfileRow = Tables<'profiles'>
export type WorkspaceRow = Tables<'workspaces'>
export type WorkspaceLimitsRow = Tables<'workspace_limits'>

export const PAGE_SIZE = 50

export function listPlatformInvites(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.from('platform_invites').select('*').order('created_at', { ascending: false }).limit(300),
    (rows): PlatformInvite[] => rows ?? [],
  )
}

export const createPlatformInviteInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase().max(320).nullable(),
  note: z.string().trim().max(200, 'Use 200 characters or fewer.').nullable(),
  expiresInDays: z.number().int().min(1).max(90),
})

/** admin_issue_platform_invite: returns the row with its token. Audited as invite.create. */
export function adminIssuePlatformInvite(client: UserClient, input: z.input<typeof createPlatformInviteInput>) {
  return call(
    createPlatformInviteInput,
    input,
    (v) =>
      client
        .rpc('admin_issue_platform_invite', {
          ...(v.email ? { p_email: v.email } : {}),
          ...(v.note ? { p_note: v.note } : {}),
          p_expires_in_days: v.expiresInDays,
        })
        .single(),
    (row): PlatformInvite => row as unknown as PlatformInvite,
  )
}

export const inviteIdInput = z.object({ inviteId: id })

/** Open invites only; anything else raises invalid_state. Audited as invite.revoke. */
export function adminRevokePlatformInvite(client: UserClient, input: z.input<typeof inviteIdInput>) {
  return call(
    inviteIdInput,
    input,
    (v) => client.rpc('admin_revoke_platform_invite', { p_invite_id: v.inviteId }),
    () => undefined,
  )
}

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
  markdown: z.string().max(PRIVACY_NOTICE_MAX, 'The notice is longer than 50,000 characters.'),
})

/** Audited as settings.privacy_notice. */
export function adminUpdatePrivacyNotice(client: UserClient, input: z.input<typeof updatePrivacyNoticeInput>) {
  return call(
    updatePrivacyNoticeInput,
    input,
    (v) => client.rpc('admin_update_privacy_notice', { p_markdown: v.markdown }),
    () => undefined,
  )
}

/** Service role, for the public /privacy page: the organization notice markdown. */
export function privacyNotice(admin: AdminClient) {
  return call(
    z.object({}),
    {},
    () => admin.from('platform_settings').select('privacy_notice_md, updated_at').eq('id', true).maybeSingle(),
    (row): { markdown: string; updatedAt: string | null } => ({
      markdown: row?.privacy_notice_md ?? '',
      updatedAt: row?.updated_at ?? null,
    }),
  )
}

// --- abuse reports -----------------------------------------------------------

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

export const setAbuseStatusInput = z.object({ reportId: id, status: z.enum(ABUSE_STATUSES) })

/** Audited as abuse_report.{status}. */
export function adminSetAbuseReportStatus(client: UserClient, input: z.input<typeof setAbuseStatusInput>) {
  return call(
    setAbuseStatusInput,
    input,
    (v) => client.rpc('admin_set_abuse_report_status', { p_report_id: v.reportId, p_status: v.status }),
    () => undefined,
  )
}

/** Matches the abuse_reports.reason check constraint (migration 0010). */
export const ABUSE_REASONS = ['phishing', 'sensitive_data', 'harassment', 'other'] as const

export const abuseReportInput = z.object({
  survey_id: id.nullable(),
  workspace_id: id.nullable(),
  slug_text: z.string().max(100),
  reason: z.enum(ABUSE_REASONS),
  details: z.string().max(2000).nullable(),
  reporter_contact: z.string().max(200).nullable(),
  ip_hash: z.string().max(64).nullable(),
})

/** Service role, from the public report form after Turnstile and rate limits. */
export function insertAbuseReport(admin: AdminClient, input: z.input<typeof abuseReportInput>) {
  return call(abuseReportInput, input, (v) => admin.from('abuse_reports').insert(v), () => undefined)
}

// --- platform audit log --------------------------------------------------------

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

export const platformAuditInput = z.object({
  actorId: id.nullable(),
  action: z.string().min(1).max(80),
  targetType: z.string().min(1).max(40),
  targetId: id.nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
})

/**
 * Service role. Audit row for an Auth admin API action (password reset link,
 * sign-in ban), which has no SQL function to audit itself. Every other
 * platform admin write audits inside SQL.
 */
export function insertPlatformAudit(admin: AdminClient, input: z.input<typeof platformAuditInput>) {
  return call(
    platformAuditInput,
    input,
    (v) =>
      admin.from('platform_audit_log').insert({
        actor: v.actorId,
        action: v.action,
        target_type: v.targetType,
        target_id: v.targetId,
        details: v.details as { [key: string]: Json },
      }),
    () => undefined,
  )
}

// --- workspaces, limits, profiles (platform admin reads) -------------------------

/** Every workspace including archived and deletion requested (workspaces_select allows platform admins). */
export function listAllWorkspaces(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.from('workspaces').select('*').order('name', { ascending: true }).limit(1000),
    (rows): WorkspaceRow[] => rows ?? [],
  )
}

export type WorkspaceStats = {
  workspace_id: string
  owner_id: string | null
  member_count: number
  survey_count: number
  response_count: number
  storage_bytes_used: number
}

/** Platform admin (migration 0018): numbers and the owner id per workspace, deleted ones included. */
export function adminWorkspaceStats(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.rpc('admin_workspace_stats'),
    (rows): WorkspaceStats[] =>
      (rows ?? []).map((r) => ({
        workspace_id: r.workspace_id,
        owner_id: r.owner_id ?? null,
        member_count: Number(r.member_count ?? 0),
        survey_count: Number(r.survey_count ?? 0),
        response_count: Number(r.response_count ?? 0),
        storage_bytes_used: Number(r.storage_bytes_used ?? 0),
      })),
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

export type AdminMemberRow = { user_id: string; role: WorkspaceRole; display_name: string; status: string }

/** Service role. Members of one workspace for the force transfer picker. Names and roles only. */
export function adminWorkspaceMembers(admin: AdminClient, input: z.input<typeof workspaceIdInput>) {
  return call(
    workspaceIdInput,
    input,
    (v) =>
      admin
        .from('workspace_members')
        .select('user_id, role, profile:profiles(display_name, status)')
        .eq('workspace_id', v.workspaceId),
    (rows): AdminMemberRow[] =>
      (rows ?? []).map((r) => {
        const p = r.profile as { display_name: string; status: string } | null
        return { user_id: r.user_id, role: r.role, display_name: p?.display_name ?? 'Unknown user', status: p?.status ?? 'pending' }
      }),
  )
}

export type UserMembership = { workspaceId: string; name: string; slug: string; role: WorkspaceRole }

/** Service role. Every membership keyed by user id, for the /admin/users list. Names and roles only. */
export function adminMembershipsByUser(admin: AdminClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => admin.from('workspace_members').select('user_id, role, workspace:workspaces(id, name, slug)').limit(10_000),
    (rows): Map<string, UserMembership[]> => {
      const out = new Map<string, UserMembership[]>()
      for (const r of rows ?? []) {
        const w = r.workspace as { id: string; name: string; slug: string } | null
        if (!w) continue
        out.set(r.user_id, [...(out.get(r.user_id) ?? []), { workspaceId: w.id, name: w.name, slug: w.slug, role: r.role }])
      }
      return out
    },
  )
}

// --- direct membership (R20, migration 0020) ----------------------------------
// Platform admin only, never the owner role (ownership moves only through
// transfer_workspace_ownership). Each writes platform_audit_log in SQL.

export const adminMemberInput = z.object({ workspaceId: id, userId: id })
export const adminMemberRoleInput = adminMemberInput.extend({ role: workspaceRole.exclude(['owner']) })

/** Any active user into any (not deleted) workspace. Raises invalid_role, target_not_active, already_member. */
export function adminAddWorkspaceMember(client: UserClient, input: z.input<typeof adminMemberRoleInput>) {
  return call(
    adminMemberRoleInput,
    input,
    (v) =>
      client.rpc('admin_add_workspace_member', { p_workspace_id: v.workspaceId, p_user_id: v.userId, p_role: v.role }),
    () => undefined,
  )
}

/** Anyone but the owner. Their owned surveys move to the workspace owner. */
export function adminRemoveWorkspaceMember(client: UserClient, input: z.input<typeof adminMemberInput>) {
  return call(
    adminMemberInput,
    input,
    (v) => client.rpc('admin_remove_workspace_member', { p_workspace_id: v.workspaceId, p_user_id: v.userId }),
    () => undefined,
  )
}

/** A non-owner's role to admin, editor or viewer. The same role is a no-op. */
export function adminSetMemberRole(client: UserClient, input: z.input<typeof adminMemberRoleInput>) {
  return call(
    adminMemberRoleInput,
    input,
    (v) => client.rpc('admin_set_member_role', { p_workspace_id: v.workspaceId, p_user_id: v.userId, p_role: v.role }),
    () => undefined,
  )
}

// --- access and workspace requests (doc 05 sections 1.1 and 4.2) ---------------

export type AccessRequest = Tables<'access_requests'>
export type WorkspaceRequest = Tables<'workspace_requests'>
export const REQUEST_STATUSES = ['open', 'approved', 'dismissed'] as const

export const createAccessRequestInput = z.object({
  userId: id,
  name: z.string().trim().min(1, 'Enter your name.').max(120, 'Use 120 characters or fewer.'),
  department: z.string().trim().max(120, 'Use 120 characters or fewer.').nullable(),
  reason: z.string().trim().max(2000, 'Use 2000 characters or fewer.').nullable(),
})

/** The requester's own insert under RLS. */
export function createAccessRequest(client: UserClient, input: z.input<typeof createAccessRequestInput>) {
  return call(
    createAccessRequestInput,
    input,
    (v) =>
      client
        .from('access_requests')
        .insert({ user_id: v.userId, name: v.name, department: v.department, reason: v.reason })
        .select('id')
        .single(),
    (row): string => (row as { id: string }).id,
  )
}

export const userIdInput = z.object({ userId: id })

export function getOpenAccessRequest(client: UserClient, input: z.input<typeof userIdInput>) {
  return call(
    userIdInput,
    input,
    (v) => client.from('access_requests').select('*').eq('user_id', v.userId).eq('status', 'open').maybeSingle(),
    (row): AccessRequest | null => row ?? null,
  )
}

export const createWorkspaceRequestInput = z.object({
  userId: id,
  departmentName: z.string().trim().min(1, 'Enter the department name.').max(80, 'Use 80 characters or fewer.'),
  purpose: z.string().trim().max(2000, 'Use 2000 characters or fewer.').nullable(),
})

export function createWorkspaceRequest(client: UserClient, input: z.input<typeof createWorkspaceRequestInput>) {
  return call(
    createWorkspaceRequestInput,
    input,
    (v) =>
      client
        .from('workspace_requests')
        .insert({ requested_by: v.userId, department_name: v.departmentName, purpose: v.purpose })
        .select('id')
        .single(),
    (row): string => (row as { id: string }).id,
  )
}

export function listMyWorkspaceRequests(client: UserClient, input: z.input<typeof userIdInput>) {
  return call(
    userIdInput,
    input,
    (v) =>
      client
        .from('workspace_requests')
        .select('*')
        .eq('requested_by', v.userId)
        .order('created_at', { ascending: false })
        .limit(20),
    (rows): WorkspaceRequest[] => rows ?? [],
  )
}

export const listRequestsInput = z.object({ status: z.enum(REQUEST_STATUSES).default('open') })

/** Platform admin. */
export function listAccessRequests(client: UserClient, input: z.input<typeof listRequestsInput> = {}) {
  return call(
    listRequestsInput,
    input,
    (v) =>
      client.from('access_requests').select('*').eq('status', v.status).order('created_at', { ascending: false }).limit(200),
    (rows): AccessRequest[] => rows ?? [],
  )
}

/** Platform admin. */
export function listWorkspaceRequests(client: UserClient, input: z.input<typeof listRequestsInput> = {}) {
  return call(
    listRequestsInput,
    input,
    (v) =>
      client
        .from('workspace_requests')
        .select('*')
        .eq('status', v.status)
        .order('created_at', { ascending: false })
        .limit(200),
    (rows): WorkspaceRequest[] => rows ?? [],
  )
}

export function getWorkspaceRequest(client: UserClient, input: z.input<typeof requestIdInput>) {
  return call(
    requestIdInput,
    input,
    (v) => client.from('workspace_requests').select('*').eq('id', v.requestId).maybeSingle(),
    (row): WorkspaceRequest | null => row ?? null,
  )
}

/** Platform admin; open requests only (invalid_state otherwise). Audited as access_request.dismiss. */
export function adminDismissAccessRequest(client: UserClient, input: z.input<typeof requestIdInput>) {
  return call(
    requestIdInput,
    input,
    (v) => client.rpc('admin_dismiss_access_request', { p_request_id: v.requestId }),
    () => undefined,
  )
}

/** Platform admin; open requests only. Approval is admin_create_workspace(p_request_id). */
export function adminDismissWorkspaceRequest(client: UserClient, input: z.input<typeof requestIdInput>) {
  return call(
    requestIdInput,
    input,
    (v) => client.rpc('admin_dismiss_workspace_request', { p_request_id: v.requestId }),
    () => undefined,
  )
}
