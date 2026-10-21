import { z } from 'zod'
import type { UserClient } from '@/lib/supabase/types'
import { call } from './rpc'

/**
 * Invite claiming (migration 0004, doc 05 section 3). All three are thin
 * wrappers over SQL apply_invites and return its `{status, workspace_id}`.
 * Creating and revoking invite rows is a table write under RLS (admin and
 * owner); those helpers belong to Phase 2A in this folder.
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
