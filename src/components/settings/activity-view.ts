/**
 * Activity and audit log filter helpers. Pure, unit tested. Filters live in
 * the query string so a filtered view is a shareable link and works without
 * JavaScript.
 */
export type LogFilters = Record<string, string | undefined>

/** Picks known keys with non-empty string values from searchParams. */
export function readFilters(
  sp: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): LogFilters {
  const out: LogFilters = {}
  for (const k of keys) {
    const v = sp[k]
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim()
  }
  return out
}

export function readPage(sp: Record<string, string | string[] | undefined>): number {
  const n = Number(typeof sp.page === 'string' ? sp.page : '1')
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1
}

export function pageHref(path: string, filters: LogFilters, page: number): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v)
  if (page > 1) q.set('page', String(page))
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** `{"name": ["Old", "New"]}` diff rows as readable lines. */
export function diffLines(diff: unknown): Array<{ field: string; from: string; to: string }> {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return []
  return Object.entries(diff as Record<string, unknown>).map(([field, v]) => {
    const pair = Array.isArray(v) && v.length === 2 ? v : [undefined, v]
    const show = (x: unknown) => (x === undefined ? '' : x === null ? 'empty' : typeof x === 'string' ? x : JSON.stringify(x))
    return { field, from: show(pair[0]), to: show(pair[1]) }
  })
}
