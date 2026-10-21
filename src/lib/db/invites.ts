import { z } from 'zod'
import type { Tables, WorkspaceRole } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { affected, call, id } from './rpc'

/**
 * Invite claiming (migration 0004, doc 05 section 3). All three are thin
 * wrappers over SQL apply_invites and return its `{status, workspace_id}`.
 * Creating and revoking workspace invite rows is a table write under RLS
 * (admin; admin invites need owner), below.
 */
export const INVITE_CLAIM_STATUSES = [
  'joined', // workspace invite accepted, membership created
  'already_member', // workspace invite valid, caller already a member, role unchanged
  'activated', // profile went from pending to active
  'active', // nothing to claim, already active
  'pending', // nothing valid to claim, still pending
  'invalid', // token unknown, expired, revoked or exhausted
  'disabled', // profile disabled or deleted, nothing applied
] as const

export type InviteClaimStatus = (typeof INVITE_CLAIM_STATUSES)[number]
export type InviteClaim = { status: InviteClaimStatus; workspace_id: string | null }

const claimShape = z.object({
  status: z.enum(INVITE_CLAIM_STATUSES),
  workspace_id: z.string().nullable(),
})

function toClaim(data: unknown): InviteClaim {
  const parsed = claimShape.safeParse(data)
  return parsed.success ? parsed.data : { status: 'invalid', workspace_id: null }
}

export const inviteTokenInput = z.object({ token: z.string().trim().min(1).max(200) })

/** "Check again" on /pending and on every sign-in: email match only. */
export function claimPendingInvite(client: UserClient) {
  return call(z.undefined().optional(), undefined, () => client.rpc('claim_pending_invite'), toClaim)
}

/** /invite/{token}: platform invite token from the HttpOnly cookie. */
export function claimPlatformInvite(client: UserClient, input: z.input<typeof inviteTokenInput>) {
  return call(inviteTokenInput, input, (v) => client.rpc('claim_platform_invite', { p_token: v.token }), toClaim)
}

/** /join/{token}: workspace invite token from the HttpOnly cookie. */
export function acceptWorkspaceInvite(client: UserClient, input: z.input<typeof inviteTokenInput>) {
  return call(inviteTokenInput, input, (v) => client.rpc('accept_workspace_invite', { p_token: v.token }), toClaim)
}

export type InvitePreview = { workspace_name: string; logo_path: string | null; role: WorkspaceRole }

/**
 * What /invite/{token} may show a signed-in visitor before accepting
 * (migration 0018): workspace name, logo and role of an open workspace
 * invite, or null for anything else.
 */
export function invitePreview(client: UserClient, input: z.input<typeof inviteTokenInput>) {
  return call(
    inviteTokenInput,
    input,
    (v) => client.rpc('invite_preview', { p_token: v.token }).maybeSingle(),
    (row): InvitePreview | null =>
      row ? { workspace_name: row.workspace_name, logo_path: row.logo_path ?? null, role: row.role } : null,
  )
}

// --- workspace invite links (doc 05 section 3.2) ----------------------------------

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
