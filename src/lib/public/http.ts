import 'server-only'
import type { z } from 'zod'

/**
 * Small helpers shared by the /api/public route handlers: JSON responses,
 * a size-limited JSON body reader, and the request IP.
 */

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response }

/**
 * Method, content type, size and shape, in that order. Returns a ready
 * Response on failure so the caller can return it unchanged.
 */
export async function readJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number,
): Promise<BodyResult<z.output<S>>> {
  if (req.method !== 'POST') {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 405, { allow: 'POST' }) }
  }
  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  // sendBeacon with a JSON Blob sends application/json; text/plain is refused.
  if (!type.startsWith('application/json')) {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 415) }
  }
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 413) }
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 400) }
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 413) }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 400) }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, response: json({ ok: false, code: 'invalid_request' }, 400) }
  return { ok: true, data: parsed.data }
}

/** First x-forwarded-for entry (Vercel sets it), else x-real-ip, else a fixed placeholder. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  if (first) return first.slice(0, 64)
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real.slice(0, 64)
  // Decision: local dev has no proxy header; every request shares one bucket.
  return '0.0.0.0'
}

/** True in `next dev` and vitest, false in production builds. */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}
