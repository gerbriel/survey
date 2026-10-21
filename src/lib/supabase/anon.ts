import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { supabaseAnonKey, supabaseUrl } from './env'
import type { AnonClient } from './types'

/**
 * Anon-key client with no cookie adapter and no session, for the (public)
 * route group and /api/public/* (R1, R15). It never reads or writes a cookie,
 * so a public page can never pick up a member session even by accident.
 *
 * Anon may execute exactly two SQL functions (resolve_public_survey,
 * get_public_definition) and has no table grants. Use it only through
 * src/lib/db/publicRead.ts.
 */
export function createAnonClient(): AnonClient {
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client as unknown as AnonClient
}
