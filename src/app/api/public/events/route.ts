import { ingestBeacon } from '@/lib/analytics/events'
import { BEACON_MAX_BYTES } from '@/lib/analytics/beacon-schema'
import { clientIp } from '@/lib/public/http'

/**
 * Analytics beacon (doc 04 section 3.3), on PUBLIC_HOST. Accepts the batch
 * documented in src/lib/analytics/beacon-schema.ts as JSON or text/plain
 * (sendBeacon). Always answers 204 so a page never retries or learns
 * anything; no Turnstile, no cookies, nothing echoed back.
 */
export async function POST(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  // I7: refuse a declared oversize body before reading it, then stream at most
  // BEACON_MAX_BYTES and stop; nothing larger is ever buffered.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > BEACON_MAX_BYTES) return done
  const raw = await readCapped(request, BEACON_MAX_BYTES)
  if (raw === null) return done
  // S11 (R17): the per-IP bucket keys on the shared client IP reader.
  const result = await ingestBeacon(raw, { ip: clientIp(request.headers) }).catch(() => ({ outcome: 'error' as const, inserted: 0 }))
  if (result.outcome === 'error') console.error('events beacon: record failed')
  return done
}

/** The body as text, or null when it exceeds max bytes or cannot be read. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}
