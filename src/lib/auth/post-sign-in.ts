import type { InviteClaim } from '@/lib/db/invites'
import type { ProfileStatus } from '@/types/db-helpers'
import { loginPath, PENDING_PATH, safeNextPath } from './paths'

export type ClaimOutcome = {
  claim: InviteClaim
  /** Slug of the workspace a workspace invite pointed at (joined or already a member). */
  workspaceSlug: string | null
  /** True when an invite cookie was present, valid or not. */
  hadToken: boolean
}

/**
 * Where to send the user after the claim. Pure, unit tested.
 * Profile status is read after the claim, because a claim can activate it.
 */
export function postSignInPath(outcome: ClaimOutcome, profileStatus: ProfileStatus | null, next: string | null): string {
  const status = profileStatus ?? 'pending'
  if (outcome.claim.status === 'disabled' || status === 'disabled' || status === 'deleted') {
    return loginPath(null, 'account_disabled')
  }
  if (status === 'pending') {
    return outcome.claim.status === 'invalid' && outcome.hadToken ? `${PENDING_PATH}?invite=invalid` : PENDING_PATH
  }
  if (outcome.workspaceSlug && (outcome.claim.status === 'joined' || outcome.claim.status === 'already_member')) {
    const base = `/w/${encodeURIComponent(outcome.workspaceSlug)}`
    return outcome.claim.status === 'already_member' ? `${base}?invite=already_member` : base
  }
  const dest = safeNextPath(next)
  if (outcome.claim.status === 'invalid' && outcome.hadToken) {
    return `${dest}${dest.includes('?') ? '&' : '?'}invite=invalid`
  }
  return dest
}
