import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { authCookieOptions } from './cookies'
import type { UserClient } from './types'

/**
 * Client for dashboard client components (realtime, uploads). Anon key plus
 * the member's session cookie, so RLS applies. Cookies are host-only to
 * DASHBOARD_HOST: no Domain attribute (see cookies.ts). Never used on the
 * public host. @supabase/ssr keeps one instance per browser tab.
 */
export function createBrowserClient(): UserClient {
  const client = createSsrBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: authCookieOptions() },
  )
  return client as unknown as UserClient
}
