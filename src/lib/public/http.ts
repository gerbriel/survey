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

/**
 * S9 (R17, F1, public I2): the one client IP reader for every public route,
 * server action and limiter. Precedence:
 *   1. x-vercel-forwarded-for (set by the platform, the client cannot forge it)
 *   2. x-real-ip (platform or a trusted proxy)
 *   3. the LAST x-forwarded-for entry (the hop our proxy appended); the
 *      first entry is whatever the client sent and is never trusted
 *   4. a fixed placeholder (local dev has no proxy header)
 * Returns the full address; rate limit keys reduce it with `rateKeyIp`.
 */
export function clientIp(headers: Headers): string {
  const platform = firstEntry(headers.get('x-vercel-forwarded-for'))
  if (platform) return platform
  const real = firstEntry(headers.get('x-real-ip'))
  if (real) return real
  const last = headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).at(-1)
  if (last) return last.slice(0, 64)
  // Decision: local dev has no proxy header; every request shares one bucket.
  return '0.0.0.0'
}

function firstEntry(v: string | null): string | null {
  const first = v?.split(',')[0]?.trim()
  return first ? first.slice(0, 64) : null
}

/** Expands an IPv6 address to eight 4-digit groups, or null when it is not one. */
function expandIpv6(ip: string): string[] | null {
  let addr = ip.replace(/^\[|\](:\d+)?$/g, '').replace(/%.*$/, '').toLowerCase()
  // Trailing dotted IPv4 (for example ::ffff:192.0.2.1) becomes two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
  if (v4) {
    const n = v4.slice(1).map(Number)
    if (n.some((x) => x > 255)) return null
    addr = addr.slice(0, v4.index) + ((n[0]! << 8) | n[1]!).toString(16) + ':' + ((n[2]! << 8) | n[3]!).toString(16)
  }
  if (!/^[0-9a-f:]+$/.test(addr) || (addr.match(/::/g) ?? []).length > 1) return null
  const [head, tail] = addr.includes('::') ? addr.split('::') : [addr, undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = tail === undefined ? 0 : 8 - h.length - t.length
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => g.padStart(4, '0'))
}

/**
 * S9 (R17, public M1): the address a per-IP rate limit bucket keys on. IPv4
 * is unchanged; IPv6 is reduced to its /64 prefix so rotating addresses
 * inside one allocation does not mint fresh buckets. IPv4-mapped IPv6 maps
 * back to the IPv4 address.
 */
export function rateKeyIp(ip: string): string {
  if (!ip.includes(':')) return ip
  const g = expandIpv6(ip)
  if (!g) return ip
  if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {
    const a = parseInt(g[6]!, 16)
    const b = parseInt(g[7]!, 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return `${g.slice(0, 4).join(':')}::/64`
}

/** True in `next dev` and vitest, false in production builds. */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}
