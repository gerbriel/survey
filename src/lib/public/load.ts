import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getPublicDefinition, resolvePublicSurvey, type PublicSurvey } from '@/lib/db/publicRead'
import { getEffectiveLimits, GLOBAL_LIMIT_DEFAULTS, type EffectiveLimits } from '@/lib/db/limits'
import { createAnonClient } from '@/lib/supabase/anon'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/db-helpers'
import { surveyWorkspace } from './db'

/**
 * The public read path (doc 02 section 4, R1): resolve_public_survey per
 * request with the anon client, then the browser-safe definition by version
 * id from a cache (published versions are immutable).
 */

export type LoadedSurvey =
  | { kind: 'not_found' }
  | { kind: 'state'; survey: PublicSurvey }
  | { kind: 'open'; survey: PublicSurvey & { version_id: string }; definition: Json; versionNo: number }

/** Survey keys as the proxy admits them (`/{slug}` or `/{alias}`). */
export const KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

/** Anon client per request, or null when Supabase is not configured (dev without keys). */
function anonOrNull() {
  try {
    return createAnonClient()
  } catch (e) {
    console.error('[public] anon client unavailable:', (e as Error).message)
    return null
  }
}

/** One state lookup per request, shared by generateMetadata and the page. */
export const resolveSurvey = cache(async (key: string): Promise<PublicSurvey | null> => {
  if (!KEY_RE.test(key)) return null
  const anon = anonOrNull()
  if (!anon) return null
  const r = await resolvePublicSurvey(anon, { key })
  if (!r.ok) {
    console.error('[public] resolve_public_survey failed', r.error.code)
    return null
  }
  return r.data
})

/**
 * Cached forever per (versionId, key). Decision: unstable_cache rather than
 * 'use cache', because cacheComponents is not enabled in next.config.ts and
 * turning it on changes every route in the app. Null results throw so they
 * are never cached (a survey that closes and reopens must not stick at null).
 */
const cachedDefinition = unstable_cache(
  async (versionId: string, key: string): Promise<{ definition: Json; versionNo: number }> => {
    const anon = createAnonClient()
    const r = await getPublicDefinition(anon, { versionId, key })
    if (!r.ok) throw new Error(`get_public_definition failed: ${r.error.code}`)
    if (!r.data) throw new Error('get_public_definition returned nothing')
    return { definition: r.data.public_definition, versionNo: r.data.version_no }
  },
  ['public-definition-v1'],
  { revalidate: false },
)

export async function definitionFor(versionId: string, key: string): Promise<{ definition: Json; versionNo: number } | null> {
  try {
    return await cachedDefinition(versionId, key)
  } catch (e) {
    console.error('[public]', (e as Error).message)
    return null
  }
}

export const loadPublicSurvey = cache(async (key: string): Promise<LoadedSurvey> => {
  const survey = await resolveSurvey(key)
  if (!survey) return { kind: 'not_found' }
  if (survey.effective_state !== 'open' || !survey.version_id) return { kind: 'state', survey }
  const def = await definitionFor(survey.version_id, key)
  // An open survey whose definition cannot load is a server error, not a closed survey.
  if (!def) throw new Error('public definition unavailable')
  return { kind: 'open', survey: survey as PublicSurvey & { version_id: string }, definition: def.definition, versionNo: def.versionNo }
})

export type SurveyContext = { workspaceId: string; limits: EffectiveLimits }

/**
 * Workspace id and effective limits for a survey. Cached five minutes: limit
 * overrides are rare and only a platform admin changes them. Null when the
 * service role is not configured or the survey is gone.
 */
const cachedContext = unstable_cache(
  async (surveyId: string): Promise<SurveyContext | null> => {
    const admin = createAdminClient()
    const s = await surveyWorkspace(admin, { surveyId })
    if (!s.ok) throw new Error(`survey lookup failed: ${s.error.code}`)
    if (!s.data) return null
    const l = await getEffectiveLimits(admin, { workspaceId: s.data.workspace_id })
    return { workspaceId: s.data.workspace_id, limits: l.ok && l.data ? l.data : { ...GLOBAL_LIMIT_DEFAULTS } }
  },
  ['public-survey-context-v1'],
  { revalidate: 300 },
)

export async function surveyContext(surveyId: string): Promise<SurveyContext | null> {
  try {
    return await cachedContext(surveyId)
  } catch (e) {
    console.error('[public]', (e as Error).message)
    return null
  }
}

/** Public URL of an object in the public-assets bucket. Accepts paths with or without the bucket prefix. */
export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  const clean = path.replace(/^\/+/, '').replace(/^public-assets\//, '')
  if (clean.includes('..')) return null
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/public-assets/${clean.split('/').map(encodeURIComponent).join('/')}`
}

/** `https://{PUBLIC_HOST}` (http in dev), for metadataBase and copyable links. */
export function publicOrigin(): string {
  const host = process.env.PUBLIC_HOST ?? 's.localhost:3000'
  const proto = process.env.NODE_ENV === 'development' ? 'http' : 'https'
  return `${proto}://${host}`
}
