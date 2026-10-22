import 'server-only'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { ogCard, type OgCard } from '@/lib/db/publicRead'
import { coverOgSrc } from '@/lib/survey/cover'
import { clientIp } from './http'
import { KEY_RE, publicAssetUrl, resolveSurvey } from './load'
import { checkRateLimits, hashIp, RATE_LIMITS, rateLimitSecret } from './ratelimit'

/**
 * Data for the generated link preview card (doc 02 section 4). Published
 * versions are immutable, so a found card is cached forever per version id.
 * Decision: the workspace name and logo are read at first render and then
 * frozen with the card; a new logo shows on the next published version.
 *
 * L7: the card is served only while resolve_public_survey returns the survey
 * for the key in the URL (never for a draft, archived or deleted one) and the
 * version belongs to that survey; requests are rate limited per IP; a miss
 * throws inside the cache so it is never stored, and the 404 is cacheable
 * for at most 60 seconds.
 */

export type OgCardData = OgCard & { logoUrl: string | null; coverUrl: string | null }

const MISS = 'og-card-miss'

const cached = unstable_cache(
  async (versionId: string): Promise<OgCardData> => {
    const r = await ogCard(createAdminClient(), { versionId })
    if (!r.ok) throw new Error(`og card lookup failed: ${r.error.code}`)
    // L7: throw on a miss so null is never cached.
    if (!r.data) throw new Error(MISS)
    // The theme's header image as a band across the top: starter or public-assets only (doc 03 section 8.1).
    return { ...r.data, logoUrl: publicAssetUrl(r.data.logoPath), coverUrl: coverOgSrc(r.data.cover, publicAssetUrl) }
  },
  ['public-og-card-v3'],
  { revalidate: false },
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function ogCardFor(versionId: string): Promise<OgCardData | null> {
  if (!UUID_RE.test(versionId)) return null
  try {
    return await cached(versionId.toLowerCase())
  } catch (e) {
    if ((e as Error).message !== MISS) console.error('[public]', (e as Error).message)
    return null
  }
}

export type OgLookup = { kind: 'card'; card: OgCardData } | { kind: 'not_found' } | { kind: 'rate_limited'; retryAfter: number }

/** L7: rate limit, state check by key, then the cached card for a version of that survey. */
export async function ogCardForRequest(req: Request, versionId: string): Promise<OgLookup> {
  const key = (new URL(req.url).searchParams.get('k') ?? '').toLowerCase()
  if (!UUID_RE.test(versionId) || !KEY_RE.test(key)) return { kind: 'not_found' }
  const rl = await checkRateLimits(createAdminClient(), [{ rule: RATE_LIMITS.og, key: hashIp(clientIp(req.headers), rateLimitSecret()) }])
  if (!rl.ok) return { kind: 'rate_limited', retryAfter: rl.retryAfter }
  const survey = await resolveSurvey(key)
  if (!survey) return { kind: 'not_found' }
  const card = await ogCardFor(versionId)
  if (!card || card.surveyId !== survey.survey_id) return { kind: 'not_found' }
  return { kind: 'card', card }
}
