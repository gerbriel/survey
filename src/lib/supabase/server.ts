import 'server-only'
import { createServerClient as createSsrServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { authCookieOptions, hostOnlyCookieOptions } from './cookies'
import { supabaseAnonKey, supabaseUrl } from './env'
import type { UserClient } from './types'

/**
 * Cookie-bound client for the dashboard host: server components, server
 * actions and route handlers. Runs as the signed-in member, so RLS applies;
 * this is not an escape hatch. Never imported under src/app/(public) (ESLint
 * enforces it). Cookies are host-only to DASHBOARD_HOST (see cookies.ts).
 *
 * Create one per request; never cache it in module scope.
 */
export async function createServerClient(): Promise<UserClient> {
  const cookieStore = await cookies()
  const client = createSsrServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hostOnlyCookieOptions(options))
          }
        } catch {
          // Server components cannot write cookies. The proxy refreshes the
          // session on every dashboard request, so dropping the write is safe.
        }
      },
    },
  })
  return client as unknown as UserClient
}
