import { z } from 'zod'
import type { UserClient, UserOrAdminClient, AdminClient } from '@/lib/supabase/types'
import { asJson, call, id, workspaceSlug } from './rpc'

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
