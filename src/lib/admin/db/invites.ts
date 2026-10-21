import 'server-only'
import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from '@/lib/db/rpc'
import { affected } from './shared'

/** Workspace invite links (doc 05 section 3.2). RLS: admin reads and writes; admin invites need owner. */
export type WorkspaceInvite = Tables<'workspace_invites'>

export const INVITE_EXPIRY_DAYS = [1, 7, 30] as const

export const listInvitesInput = z.object({ workspaceId: id })

export function listWorkspaceInvites(client: UserClient, input: z.input<typeof listInvitesInput>) {
  return call(
    listInvitesInput,
    input,
    (v) =>
      client
        .from('workspace_invites')
        .select('*')
        .eq('workspace_id', v.workspaceId)
        .order('created_at', { ascending: false })
        .limit(200),
    (rows): WorkspaceInvite[] => rows ?? [],
  )
}

export const createInviteInput = z.object({
  workspaceId: id,
  role: z.enum(['admin', 'editor', 'viewer']),
  expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  maxUses: z.number().int().min(1, 'At least 1 use.').max(50, 'At most 50 uses.'),
  label: z.string().trim().max(80, 'Use 80 characters or fewer.').nullable(),
})

/** Returns the new invite with its token. The guard trigger stamps created_by. */
export function createWorkspaceInvite(client: UserClient, input: z.input<typeof createInviteInput>) {
  return call(
    createInviteInput,
    input,
    (v) =>
      client
        .from('workspace_invites')
        .insert({
          workspace_id: v.workspaceId,
          role: v.role,
          max_uses: v.maxUses,
          label: v.label,
          expires_at: new Date(Date.now() + v.expiresInDays * 86_400_000).toISOString(),
        })
        .select('*')
        .single(),
    (row): WorkspaceInvite => row as WorkspaceInvite,
  )
}

export const revokeInviteInput = z.object({ workspaceId: id, inviteId: id })

export function revokeWorkspaceInvite(client: UserClient, input: z.input<typeof revokeInviteInput>) {
  return call(
    revokeInviteInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_invites')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', v.inviteId)
          .eq('workspace_id', v.workspaceId)
          .is('revoked_at', null)
          .select('id'),
      ),
    () => undefined,
  )
}
