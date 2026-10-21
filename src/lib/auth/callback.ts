import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import type { UserClient } from '@/lib/supabase/types'
import { acceptWorkspaceInvite, claimPendingInvite, claimPlatformInvite, type InviteClaim } from '@/lib/db/invites'
import { getProfile } from '@/lib/db/profiles'
import { getWorkspaceById } from '@/lib/db/workspaces'
import {
  PLATFORM_INVITE_COOKIE,
  WORKSPACE_INVITE_COOKIE,
  inviteCookieName,
  inviteCookieOptions,
  isPlausibleInviteToken,
  type InviteKind,
} from './invite-cookies'
import { loginPath } from './paths'
import { postSignInPath, type ClaimOutcome } from './post-sign-in'

/**
 * OAuth callback plumbing for src/app/api/auth/callback/route.ts (Phase 2A
 * writes the route; it can be `export const GET = handleAuthCallback`).
 *
 * Steps: exchange the code for a session (cookies host-only), claim invite
 * tokens from the HttpOnly cookies through the SQL claim functions
 * (accept_workspace_invite, claim_platform_invite, else claim_pending_invite),
 * clear those cookies, and redirect. SQL decides what a token is worth; this
 * file only routes the user afterwards.
 */

/** Store an invite token for the trip through sign-in. Server action or route handler only. */
export async function setInviteCookie(kind: InviteKind, token: string): Promise<boolean> {
  if (!isPlausibleInviteToken(token)) return false
  const store = await cookies()
  store.set(inviteCookieName(kind), token, inviteCookieOptions())
  return true
}

/**
 * Claims whatever invite cookies are present, then deletes them. Also used
 * after email and password sign-in (Phase 2A login action). With no cookie it
 * runs claim_pending_invite, the Fresno 00012 email re-check.
 */
export async function claimInvitesFromCookies(supabase: UserClient): Promise<ClaimOutcome> {
  const store = await cookies()
  const wsToken = store.get(WORKSPACE_INVITE_COOKIE)?.value
  const platformToken = store.get(PLATFORM_INVITE_COOKIE)?.value
  for (const name of [WORKSPACE_INVITE_COOKIE, PLATFORM_INVITE_COOKIE]) {
    if (store.get(name)) store.set(name, '', { ...inviteCookieOptions(), maxAge: 0 })
  }

  let claim: InviteClaim | null = null
  let workspaceSlug: string | null = null

  if (wsToken) {
    const r = await acceptWorkspaceInvite(supabase, { token: wsToken.slice(0, 200) })
    claim = r.ok ? r.data : { status: 'invalid', workspace_id: null }
    if (claim.workspace_id && (claim.status === 'joined' || claim.status === 'already_member')) {
      const ws = await getWorkspaceById(supabase, { workspaceId: claim.workspace_id })
      workspaceSlug = ws.ok && ws.data ? ws.data.slug : null
    }
  }
  if (platformToken) {
    const r = await claimPlatformInvite(supabase, { token: platformToken.slice(0, 200) })
    const p: InviteClaim = r.ok ? r.data : { status: 'invalid', workspace_id: null }
    // A successful workspace join outranks the platform result.
    if (!claim || claim.status === 'invalid') claim = p
  }
  if (!claim) {
    const r = await claimPendingInvite(supabase)
    claim = r.ok ? r.data : { status: 'pending', workspace_id: null }
  }
  return { claim, workspaceSlug, hadToken: Boolean(wsToken || platformToken) }
}

/** GET handler body for /api/auth/callback. */
export async function handleAuthCallback(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl
  const next = url.searchParams.get('next')
  const code = url.searchParams.get('code')
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303)

  if (url.searchParams.get('error') || !code) return to(loginPath(next, 'oauth'))

  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return to(loginPath(next, 'oauth'))

  const outcome = await claimInvitesFromCookies(supabase)
  const profile = await getProfile(supabase, { userId: data.user.id })
  const status = profile.ok && profile.data ? profile.data.status : null
  return to(postSignInPath(outcome, status, next))
}

export { postSignInPath, type ClaimOutcome }
