'use server'

import { redirect } from 'next/navigation'
import { claimInvitesFromCookies, getAuthContext, isPlausibleInviteToken, LOGIN_PATH, postSignInPath, setInviteCookie } from '@/lib/auth'
import { getProfile } from '@/lib/db/profiles'

/**
 * /invite/{token} serves both platform and workspace invite links (doc 05
 * section 3; the proxy has one `invite` segment, no `join`).
 * Decision: the page cannot tell the two apart without a lookup (no
 * invite preview function exists for a signed-out visitor), so the token is
 * stored in both cookies. claimInvitesFromCookies tries the workspace claim
 * first and falls back to the platform claim; the wrong kind is simply
 * "invalid" and ignored.
 */
async function storeToken(token: string): Promise<boolean> {
  if (!isPlausibleInviteToken(token)) return false
  const a = await setInviteCookie('workspace', token)
  const b = await setInviteCookie('platform', token)
  return a && b
}

/** Signed out: keep the token for the trip through sign-in. */
export async function continueToSignIn(token: string): Promise<void> {
  if (!(await storeToken(token))) redirect('/pending?invite=invalid')
  redirect(LOGIN_PATH)
}

/** Signed in: claim now and route like the auth callback does. */
export async function acceptInvite(token: string): Promise<void> {
  const ctx = await getAuthContext()
  if (!ctx) return continueToSignIn(token)
  if (!(await storeToken(token))) redirect('/?invite=invalid')
  const outcome = await claimInvitesFromCookies(ctx.supabase)
  const profile = await getProfile(ctx.supabase, { userId: ctx.user.id })
  redirect(postSignInPath(outcome, profile.ok && profile.data ? profile.data.status : null, '/'))
}
