import { NextResponse, type NextRequest } from 'next/server'
import { getGoogleSignInUrl, loginPath, safeNextPath } from '@/lib/auth'

/**
 * Starts Google sign-in. A GET route, not a server action, so the button is a
 * plain link: it works without JavaScript and the dashboard CSP
 * form-action 'self' never meets the cross-origin redirect.
 * Decision: /login/google is the Google entry point for /login and /invite.
 */
export async function GET(req: NextRequest) {
  const next = safeNextPath(req.nextUrl.searchParams.get('next'), '')
  const r = await getGoogleSignInUrl({ next: next || null })
  if (!r.ok) return NextResponse.redirect(new URL(loginPath(next, 'oauth'), req.nextUrl.origin), 303)
  return NextResponse.redirect(r.url, 303)
}
