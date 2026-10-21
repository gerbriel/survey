/**
 * S6 (R18, D-02): who a platform admin may mint a password reset link for.
 * Pure so it is unit tested. Returns the refusal code, or null when allowed.
 */
export type ResetTarget = { is_platform_admin: boolean } | null

export const RESET_REFUSED_MESSAGE = 'Reset links cannot be minted for platform admins or for your own account.'

export function resetLinkRefusal(actorId: string, targetId: string, target: ResetTarget): 'not_authorized' | 'not_found' | null {
  if (actorId === targetId) return 'not_authorized'
  if (!target) return 'not_found'
  if (target.is_platform_admin) return 'not_authorized'
  return null
}
