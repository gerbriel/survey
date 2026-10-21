import { ingestBeacon } from '@/lib/analytics/events'

/**
 * Analytics beacon (doc 04 section 3.3), on PUBLIC_HOST. Accepts the batch
 * documented in src/lib/analytics/beacon-schema.ts as JSON or text/plain
 * (sendBeacon). Always answers 204 so a page never retries or learns
 * anything; no Turnstile, no cookies, nothing echoed back.
 */
export async function POST(request: Request): Promise<Response> {
  let raw = ''
  try {
    raw = await request.text()
  } catch {
    raw = ''
  }
  const result = await ingestBeacon(raw).catch(() => ({ outcome: 'error' as const, inserted: 0 }))
  if (result.outcome === 'error') console.error('events beacon: record failed')
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
