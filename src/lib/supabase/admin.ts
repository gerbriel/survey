import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { supabaseUrl } from './env'
import type { AdminClient } from './types'

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Server-only library code (src/lib/**) creates it on behalf of route
 * handlers that already authenticated and authorized the caller, or that are
 * gated by Turnstile or CRON_SECRET. Nothing under src/app imports this file
 * directly (ESLint enforces it), and it never reaches a client component.
 */
export function createAdminClient(): AdminClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (see .env.example)')
  const client = createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client as unknown as AdminClient
}
