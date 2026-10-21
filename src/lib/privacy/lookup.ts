import 'server-only'
import { z } from 'zod'
import type { LookupQuery } from '@/lib/db/privacy'

/**
 * Respondent finder input parsing for privacy tools (doc 04 section 7.2).
 * The reads themselves are findRespondents and reviewRespondent in
 * src/lib/db/privacy.ts, re-exported here.
 */
export { findRespondents, reviewRespondent, type LookupQuery, type RespondentMatch, type RespondentReview } from '@/lib/db/privacy'

const email = z.string().trim().toLowerCase().email().max(320)
const uuid = z.guid()

export function parseLookup(raw: string): LookupQuery | null {
  let v = raw.trim()
  if (!v) return null
  // A pasted personal link (https://PUBLIC_HOST/{slug}?t={token}) works too.
  if (/^https?:\/\//i.test(v)) {
    try {
      v = new URL(v).searchParams.get('t') ?? ''
    } catch {
      return null
    }
    if (!v) return null
  }
  if (email.safeParse(v).success) return { kind: 'email', value: v.toLowerCase() }
  if (uuid.safeParse(v).success) return { kind: 'id', value: v }
  if (/^[A-Za-z0-9_-]{8,100}$/.test(v)) return { kind: 'token', value: v }
  return null
}
