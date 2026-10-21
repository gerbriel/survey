import { z } from 'zod'

/**
 * Analytics filters (doc 04 section 4.3) as URL search params, and their
 * translation to the filtered_responses jsonb shape. Pure, so the same parser
 * runs in the page, the export route and tests.
 *
 *   range    7d | 30d | 90d | all | custom (Decision: default all)
 *   from,to  YYYY-MM-DD for custom; `to` is inclusive
 *   version  latest (default) | all | a version id
 *   identity all | token | identified | anonymous
 *   status   complete (default) | all
 *   lead     comma separated lead statuses
 *   tags     comma separated tags
 *   owner    comma separated owner ids
 *   aq, av   answer filter: question key and comma separated option ids
 *   amin,amax answer filter number range
 *   xt       cross-tab column question key (choice widgets only)
 *
 * Decision: contact custom fields are not filterable yet; filtered_responses
 * reads only lead_status, tags and owner_ids (foundation change request).
 */

export const RANGES = ['7d', '30d', '90d', 'all', 'custom'] as const
export type RangeKey = (typeof RANGES)[number]

const uuid = z.guid()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const LEAD = ['new', 'contacted', 'qualified', 'customer', 'lost'] as const
const QKEY = /^q_[a-z0-9]{8}$/

export type AnalyticsFilters = {
  range: RangeKey
  from: string | null
  to: string | null
  version: 'latest' | 'all' | string
  identity: 'all' | 'token' | 'identified' | 'anonymous'
  status: 'complete' | 'all'
  lead: string[]
  tags: string[]
  owners: string[]
  answer: { question_key: string; any_of?: string[]; min?: number; max?: number } | null
  crossTab: string | null
}

export const DEFAULT_FILTERS: AnalyticsFilters = {
  range: 'all',
  from: null,
  to: null,
  version: 'latest',
  identity: 'all',
  status: 'complete',
  lead: [],
  tags: [],
  owners: [],
  answer: null,
  crossTab: null,
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function get(p: Params, k: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(k) ?? undefined
  const v = p[k]
  return Array.isArray(v) ? v[0] : v
}

/** Comma separated and repeated params both work: `lead=new,lost` or `lead=new&lead=lost`. */
function list(p: Params, k: string): string[] {
  const raw = p instanceof URLSearchParams ? p.getAll(k) : ([] as string[]).concat(p[k] ?? [])
  return raw
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function parseFilters(p: Params): AnalyticsFilters {
  const f: AnalyticsFilters = { ...DEFAULT_FILTERS }
  const range = get(p, 'range')
  if (range && (RANGES as readonly string[]).includes(range)) f.range = range as RangeKey
  if (f.range === 'custom') {
    const from = get(p, 'from')
    const to = get(p, 'to')
    f.from = from && day.safeParse(from).success ? from : null
    f.to = to && day.safeParse(to).success ? to : null
  }
  const version = get(p, 'version')
  if (version === 'all' || version === 'latest') f.version = version
  else if (version && uuid.safeParse(version).success) f.version = version
  const identity = get(p, 'identity')
  if (identity === 'token' || identity === 'identified' || identity === 'anonymous') f.identity = identity
  if (get(p, 'status') === 'all') f.status = 'all'
  f.lead = list(p, 'lead').filter((s) => (LEAD as readonly string[]).includes(s))
  f.tags = list(p, 'tags').map((t) => t.slice(0, 60))
  f.owners = list(p, 'owner').filter((s) => uuid.safeParse(s).success)
  const aq = get(p, 'aq')
  if (aq && QKEY.test(aq)) {
    const anyOf = list(p, 'av').map((s) => s.slice(0, 100))
    const min = num(get(p, 'amin'))
    const max = num(get(p, 'amax'))
    if (anyOf.length || min !== undefined || max !== undefined) {
      f.answer = { question_key: aq, ...(anyOf.length ? { any_of: anyOf } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
    }
  }
  const xt = get(p, 'xt')
  if (xt && QKEY.test(xt)) f.crossTab = xt
  return f
}

/** Absolute date window for a filter set, ISO strings; `to` is exclusive. */
export function dateWindow(f: AnalyticsFilters, now: Date = new Date()): { from: string | null; to: string | null } {
  const days = f.range === '7d' ? 7 : f.range === '30d' ? 30 : f.range === '90d' ? 90 : null
  if (days) return { from: new Date(now.getTime() - days * 86400000).toISOString(), to: null }
  if (f.range === 'custom') {
    const to = f.to ? new Date(Date.parse(`${f.to}T00:00:00Z`) + 86400000).toISOString() : null
    return { from: f.from ? `${f.from}T00:00:00.000Z` : null, to }
  }
  return { from: null, to: null }
}

/** The jsonb filters argument for filtered_responses (migration 0013). */
export function toResponseFilters(f: AnalyticsFilters, now: Date = new Date()): Record<string, unknown> {
  const w = dateWindow(f, now)
  const out: Record<string, unknown> = { version: f.version, status: f.status, identity: f.identity }
  if (w.from) out.from = w.from
  if (w.to) out.to = w.to
  if (f.lead.length || f.tags.length || f.owners.length) {
    out.contact = {
      ...(f.lead.length ? { lead_status: f.lead } : {}),
      ...(f.tags.length ? { tags: f.tags } : {}),
      ...(f.owners.length ? { owner_ids: f.owners } : {}),
    }
  }
  if (f.answer) out.answers = [f.answer]
  return out
}

/** True when a filter is set that event metrics cannot honor (doc 04 section 4.3). */
export function hasNonEventFilter(f: AnalyticsFilters): boolean {
  return f.identity !== 'all' || f.lead.length > 0 || f.tags.length > 0 || f.owners.length > 0 || f.answer !== null
}

/** Back to a query string, omitting defaults. */
export function filtersToQuery(f: AnalyticsFilters): string {
  const q = new URLSearchParams()
  if (f.range !== DEFAULT_FILTERS.range) q.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) q.set('from', f.from)
    if (f.to) q.set('to', f.to)
  }
  if (f.version !== 'latest') q.set('version', f.version)
  if (f.identity !== 'all') q.set('identity', f.identity)
  if (f.status !== 'complete') q.set('status', f.status)
  if (f.lead.length) q.set('lead', f.lead.join(','))
  if (f.tags.length) q.set('tags', f.tags.join(','))
  if (f.owners.length) q.set('owner', f.owners.join(','))
  if (f.answer) {
    q.set('aq', f.answer.question_key)
    if (f.answer.any_of?.length) q.set('av', f.answer.any_of.join(','))
    if (f.answer.min !== undefined) q.set('amin', String(f.answer.min))
    if (f.answer.max !== undefined) q.set('amax', String(f.answer.max))
  }
  if (f.crossTab) q.set('xt', f.crossTab)
  return q.toString()
}

/**
 * Saved report filters (reports.filters) use the same shape as the URL, stored
 * as an object of strings. Shared reports freeze them (doc 04 section 5.4).
 */
export function filtersToRecord(f: AnalyticsFilters): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(filtersToQuery(f)).entries())
}

/**
 * reports.filters holds two things (Decision): the filtered_responses shape
 * at the top level, which shared_report_payload passes straight to SQL (so a
 * relative range such as 30d is frozen to absolute dates when saved), and
 * `ui`, the URL form, which the dashboard re-reads so in-app views of a
 * "last 30 days" report stay relative.
 */
export function reportFiltersFrom(f: AnalyticsFilters, now: Date = new Date()): Record<string, unknown> {
  return { ...toResponseFilters(f, now), ui: filtersToRecord({ ...f, crossTab: null }) }
}

export function filtersFromReport(stored: unknown): AnalyticsFilters {
  const ui = stored && typeof stored === 'object' ? (stored as { ui?: unknown }).ui : undefined
  if (!ui || typeof ui !== 'object') return { ...DEFAULT_FILTERS }
  const rec: Record<string, string> = {}
  for (const [k, v] of Object.entries(ui as Record<string, unknown>)) if (typeof v === 'string') rec[k] = v
  return parseFilters(rec)
}
