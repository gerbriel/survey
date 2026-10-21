import 'server-only'
import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from '@/lib/db/rpc'
import { affected } from './shared'

/**
 * access_requests (pending users ask for access, doc 05 section 4.2) and
 * workspace_requests (active users with no workspace ask for one, section
 * 1.1). Inserts are the requester's own under RLS; review is platform admin.
 */
export type AccessRequest = Tables<'access_requests'>
export type WorkspaceRequest = Tables<'workspace_requests'>
export const REQUEST_STATUSES = ['open', 'approved', 'dismissed'] as const

export const createAccessRequestInput = z.object({
  userId: id,
  name: z.string().trim().min(1, 'Enter your name.').max(120, 'Use 120 characters or fewer.'),
  department: z.string().trim().max(120, 'Use 120 characters or fewer.').nullable(),
  reason: z.string().trim().max(2000, 'Use 2000 characters or fewer.').nullable(),
})

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

export const requestIdInput = z.object({ requestId: id })

export function getWorkspaceRequest(client: UserClient, input: z.input<typeof requestIdInput>) {
  return call(
    requestIdInput,
    input,
    (v) => client.from('workspace_requests').select('*').eq('id', v.requestId).maybeSingle(),
    (row): WorkspaceRequest | null => row ?? null,
  )
}

export const dismissInput = z.object({ requestId: id, reviewerId: id })

/** Platform admin. Approval of access requests is admin_approve_access_request in src/lib/db/admin.ts. */
export function dismissAccessRequest(client: UserClient, input: z.input<typeof dismissInput>) {
  return call(
    dismissInput,
    input,
    (v) =>
      affected(
        client
          .from('access_requests')
          .update({ status: 'dismissed', reviewed_by: v.reviewerId, reviewed_at: new Date().toISOString() })
          .eq('id', v.requestId)
          .eq('status', 'open')
          .select('id'),
      ),
    () => undefined,
  )
}

/** Platform admin. Approval happens inside admin_create_workspace(p_request_id). */
export function dismissWorkspaceRequest(client: UserClient, input: z.input<typeof dismissInput>) {
  return call(
    dismissInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_requests')
          .update({ status: 'dismissed', reviewed_by: v.reviewerId, reviewed_at: new Date().toISOString() })
          .eq('id', v.requestId)
          .eq('status', 'open')
          .select('id'),
      ),
    () => undefined,
  )
}
