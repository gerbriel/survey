import 'server-only'
import { createServerClient } from '@/lib/supabase/server'
import { authCallbackUrl } from './paths'

/**
 * Google OAuth sign-in URL (doc 05 section 4.1: Google first). Call it from a
 * server action or route handler, then redirect the browser to the URL. It
 * must run where cookies can be written: @supabase/ssr stores the PKCE code
 * verifier in a host-only cookie that the callback reads back.
 *
 * `prompt=select_account` because members often have both a personal and a
 * work Google account (doc 05 section 3.1).
 */
export async function getGoogleSignInUrl(
  opts: { next?: string | null } = {},
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authCallbackUrl(opts.next),
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error || !data.url) return { ok: false, message: error?.message ?? 'Could not start Google sign-in.' }
  return { ok: true, url: data.url }
}
