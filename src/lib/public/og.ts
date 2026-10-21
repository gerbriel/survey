import 'server-only'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { ogCard, type OgCard } from './db'
import { publicAssetUrl } from './load'

/**
 * Data for the generated link preview card (doc 02 section 4). Published
 * versions are immutable, so the card is cached forever per version id.
 * Decision: the workspace name and logo are read at first render and then
 * frozen with the card; a new logo shows on the next published version.
 */
const cached = unstable_cache(
  async (versionId: string): Promise<(OgCard & { logoUrl: string | null }) | null> => {
    const r = await ogCard(createAdminClient(), { versionId })
    if (!r.ok) throw new Error(`og card lookup failed: ${r.error.code}`)
    if (!r.data) return null
    return { ...r.data, logoUrl: publicAssetUrl(r.data.logoPath) }
  },
  ['public-og-card-v1'],
  { revalidate: false },
)

export async function ogCardFor(versionId: string): Promise<(OgCard & { logoUrl: string | null }) | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) return null
  try {
    return await cached(versionId.toLowerCase())
  } catch (e) {
    console.error('[public]', (e as Error).message)
    return null
  }
}
