import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { authCookieOptions, hostOnlyCookieOptions } from './cookies'
import { supabaseConfigured } from './env'

/**
 * Session refresh for the dashboard host, called from src/proxy.ts only after
 * the host has been classified as DASHBOARD_HOST. Never runs on PUBLIC_HOST.
 *
 * `requestHeaders` are the headers src/proxy.ts forwards (nonce and CSP). They
 * are kept on every NextResponse.next built here, and refreshed cookies are
 * copied into them so server components in the same request see the new
 * session. Response cookies are host-only (no Domain, see cookies.ts).
 *
 * No redirects happen here: route guards live in src/lib/auth and are UX
 * only. Authorization is RLS.
 */
export async function updateSession(req: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  if (!supabaseConfigured()) return response

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) req.cookies.set(name, value)
          requestHeaders.set('cookie', req.headers.get('cookie') ?? '')
          response = NextResponse.next({ request: { headers: requestHeaders } })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, hostOnlyCookieOptions(options))
          }
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value)
        },
      },
    },
  )

  // getUser() revalidates the JWT with Supabase Auth and refreshes an expired
  // access token; getSession() would trust whatever cookie arrived.
  try {
    await supabase.auth.getUser()
  } catch {
    // Auth unreachable: serve the page; guards will send the user to /login.
  }
  return response
}
