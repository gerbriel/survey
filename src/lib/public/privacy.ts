import 'server-only'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { privacyNotice } from './db'

/**
 * The organization privacy notice a platform admin edits in /admin (doc 05),
 * read with the service role (platform_settings has no anon grant). Cached
 * five minutes; an edit shows up within that window.
 */
const cached = unstable_cache(
  async (): Promise<{ markdown: string; updatedAt: string | null }> => {
    const r = await privacyNotice(createAdminClient())
    if (!r.ok) throw new Error(`privacy notice lookup failed: ${r.error.code}`)
    return r.data
  },
  ['public-privacy-notice-v1'],
  { revalidate: 300 },
)

export async function getPrivacyNotice(): Promise<{ markdown: string; updatedAt: string | null } | null> {
  try {
    return await cached()
  } catch (e) {
    console.error('[public]', (e as Error).message)
    return null
  }
}
