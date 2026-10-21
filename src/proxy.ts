import { NextResponse, type NextRequest } from 'next/server'
import {
  PUBLIC_HOME_PATH,
  classifyHost,
  isDashboardPathAllowed,
  isPublicPathAllowed,
  publicRedirectTarget,
} from '@/lib/hosts'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Hostname routing and Content Security Policy. Runs before every matched
 * request. Spec: docs/02-public-delivery.md sections 1 and 7.1, ruling R15.
 *
 * Named `proxy`, not `middleware`: Next 16 renamed the file convention.
 *
 * Two hostnames, one deployment:
 *   PUBLIC_HOST     public surveys, report abuse, privacy notice, /api/public/*.
 *                   Never a session, never an auth cookie.
 *   DASHBOARD_HOST  everything else. Workspace pixels never load here.
 *
 * Every response gets exactly one CSP, chosen by hostname, so the two
 * policies never intersect by accident. Routing here is the first guard; the
 * two root layouts check the host again. Neither is authorization: that is
 * RLS and SQL functions.
 */

const isDev = process.env.NODE_ENV === 'development'

/** A fresh, unguessable nonce per request (128 bits, base64). */
function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

function policy(directives: string[]): string {
  return directives.join('; ')
}

/**
 * Public host: nonce plus 'strict-dynamic' so GTM and vendor loaders started
 * by a nonced script can run. `https:` in script-src is ignored by browsers
 * that support 'strict-dynamic' and is a fallback for those that do not.
 * img, connect and frame are open to https: because pixels beacon anywhere.
 * Script execution stays nonce gated, so markup injected through survey
 * content cannot run.
 */
function publicCsp(nonce: string): string {
  return policy([
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss://*.supabase.co",
    'frame-src https://challenges.cloudflare.com https://www.googletagmanager.com https:',
    "font-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ])
}

/** The Supabase origin plus its websocket twin, for the dashboard CSP. */
function supabaseSources(): { http: string; ws: string } | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return { http: url.origin, ws: `${wsProtocol}//${url.host}` }
  } catch {
    return null
  }
}

/**
 * Dashboard host, including builder preview: no third-party scripts at all.
 * Self plus the one Supabase project. 'unsafe-eval' only in dev, where React
 * needs it for error overlays.
 */
function dashboardCsp(nonce: string): string {
  const sb = supabaseSources()
  return policy([
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sb ? ` ${sb.http}` : ''}`,
    `connect-src 'self'${sb ? ` ${sb.http} ${sb.ws}` : ''}`,
    "frame-src 'none'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ])
}

/**
 * Request headers forwarded to the app. Next reads the nonce out of the
 * request CSP header and stamps its own scripts with it; server components
 * read `x-nonce` (via `headers()`) for anything they render themselves.
 */
function forwardHeaders(req: NextRequest, nonce: string, csp: string): Headers {
  const h = new Headers(req.headers)
  h.set('x-nonce', nonce)
  h.set('content-security-policy', csp)
  return h
}

function withCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set('Content-Security-Policy', csp)
  return res
}

function notFound(): NextResponse {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function proxy(req: NextRequest) {
  const env = { DASHBOARD_HOST: process.env.DASHBOARD_HOST, PUBLIC_HOST: process.env.PUBLIC_HOST }
  const kind = classifyHost(req.headers.get('host'), env)
  const path = req.nextUrl.pathname
  const nonce = makeNonce()

  // Framework internals the matcher does not already skip (dev HMR socket,
  // dev overlay endpoints). They carry no app content.
  if (kind !== 'unknown' && (path.startsWith('/_next/') || path.startsWith('/__nextjs'))) {
    return NextResponse.next()
  }

  if (kind === 'public') {
    // Never the dashboard, never a session refresh, never an auth cookie.
    if (!isPublicPathAllowed(path)) return notFound()
    const csp = publicCsp(nonce)
    const request = { headers: forwardHeaders(req, nonce, csp) }
    if (path === '/') {
      const url = req.nextUrl.clone()
      url.pathname = PUBLIC_HOME_PATH
      return withCsp(NextResponse.rewrite(url, { request }), csp)
    }
    return withCsp(NextResponse.next({ request }), csp)
  }

  if (kind !== 'dashboard') return notFound()

  // A pasted public link on the wrong host must never 404 (doc 02 section 1).
  const target = publicRedirectTarget(path, req.nextUrl.search, env.PUBLIC_HOST ?? '', isDev ? 'http' : 'https')
  if (target) return NextResponse.redirect(target, 302)

  if (!isDashboardPathAllowed(path, { dev: isDev })) return notFound()

  // Vercel Cron. The handler checks CRON_SECRET; no session, no CSP needed.
  if (path.startsWith('/api/cron/')) return NextResponse.next()

  const csp = dashboardCsp(nonce)
  // Supabase session refresh, dashboard host only (Phase 1D). updateSession
  // keeps the forwarded nonce and CSP request headers on its response and
  // writes host-only cookies (no Domain attribute). It never redirects.
  return withCsp(await updateSession(req, forwardHeaders(req, nonce, csp)), csp)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
