/**
 * Supabase settings from the environment. NEXT_PUBLIC_* names are read
 * literally so Next inlines them into the browser bundle.
 */
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set (see .env.example)')
  return v
}

export function supabaseAnonKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set (see .env.example)')
  return v
}

/** True when both public settings exist. The proxy skips session refresh otherwise. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
