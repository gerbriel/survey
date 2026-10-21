import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Client kinds, as phantom brands, so a wrapper in src/lib/db can say which
 * client it accepts and TypeScript refuses the wrong one. The brand exists
 * only at the type level; the factories in this folder apply it with a cast.
 *
 *   user   cookie-bound, runs as the signed-in member (server.ts, browser.ts, proxy.ts)
 *   anon   anon key, no cookies, no session (anon.ts). Public pages only.
 *   admin  service role, bypasses RLS (admin.ts). Server only.
 */
declare const clientKind: unique symbol

type Branded<K extends string> = SupabaseClient<Database> & { readonly [clientKind]: K }

export type UserClient = Branded<'user'>
export type AnonClient = Branded<'anon'>
export type AdminClient = Branded<'admin'>

/** Any of the three. Use only where the SQL grants execute to every role. */
export type AnyClient = UserClient | AnonClient | AdminClient
/** Signed-in member or service role: SQL functions granted to authenticated and service_role. */
export type UserOrAdminClient = UserClient | AdminClient
