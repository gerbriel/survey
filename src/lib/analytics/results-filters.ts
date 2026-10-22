import { z } from 'zod'
import { DEFAULT_FILTERS, RANGES, dateWindow, type RangeKey } from './filters'

/**
 * Results hub filters (cross-survey response explorer) as URL search params
 * or a JSON object, and their translation to per-survey queries. Pure, so the
 * hub page, the bulk export route and tests share one parser.
 *
 *   surveys  comma separated survey ids (empty: every open, closed or
 *            scheduled survey with a published version, never drafts)
 *   range    7d | 30d | 90d | all | custom, with from,to (YYYY-MM-DD)
 *   status   all | complete | partial
 *   version  all | latest | a version number (v3 or 3), applied per survey
 *   identity all | token | identified | anonymous
 *   lead, tags, owner  contact attributes (exclude anonymous responses)
 *   mk, mv   response metadata key and value: hidden.{param} or utm_{name}
 *   q        free text over open-text answers (2 to 100 characters)
 *
 * Decision: the explorer defaults to status all and version all, unlike the
 * analytics page (complete, latest): it lists responses, so partials and
 * older versions are visible unless filtered out.
 */

const uuid = z.guid()
const day = /^\d{4}-\d{2}-\d{2}$/
const LEAD = ['new', 'contacted', 'qualified', 'customer', 'lost'] as const
/** hidden.{param} or utm_{name}; the key part is a plain identifier, so it is safe in a PostgREST JSON path. */
const META_KEY = /^(hidden\.[A-Za-z0-9_]{1,64}|utm_[a-z]{1,20})$/

export const RESULTS_MAX_SURVEYS = 50
export const TEXT_MIN = 2
export const TEXT_MAX = 100

export type ResultsStatus = 'all' | 'complete' | 'partial'

export type ResultsFilters = {
  surveys: string[]
  range: RangeKey
  from: string | null
  to: string | null
  status: ResultsStatus
  /** 'all', 'latest', or a version number applied to each survey. */
  version: 'all' | 'latest' | number
  identity: 'all' | 'token' | 'identified' | 'anonymous'
  lead: string[]
  tags: string[]
  owners: string[]
  meta: { key: string; value: string } | null
  text: string | null
}

export const DEFAULT_RESULTS_FILTERS: ResultsFilters = {
  surveys: [],
  range: 'all',
  from: null,
  to: null,
  status: 'all',
  version: 'all',
  identity: 'all',
  lead: [],
  tags: [],
  owners: [],
  meta: null,
  text: null,
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function get(p: Params, k: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(k) ?? undefined
  const v = p[k]
  return Array.isArray(v) ? v[0] : v
}

function list(p: Params, k: string, max = 50): string[] {
  const raw = p instanceof URLSearchParams ? p.getAll(k) : ([] as string[]).concat(p[k] ?? [])
  return [...new Set(raw.flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean))].slice(0, max)
}

function versionOf(v: string | undefined): ResultsFilters['version'] {
  if (!v || v === 'all') return 'all'
  if (v === 'latest') return 'latest'
  const m = /^v?(\d{1,4})$/i.exec(v)
  return m ? Math.max(1, Number(m[1])) : 'all'
}

/** Search params to filters. Unknown or malformed values fall back to defaults. */
export function parseResultsFilters(p: Params): ResultsFilters {
  const f: ResultsFilters = { ...DEFAULT_RESULTS_FILTERS }
  f.surveys = list(p, 'surveys', RESULTS_MAX_SURVEYS).filter((s) => uuid.safeParse(s).success)
  const range = get(p, 'range')
  if (range && (RANGES as readonly string[]).includes(range)) f.range = range as RangeKey
  if (f.range === 'custom') {
    const from = get(p, 'from')
    const to = get(p, 'to')
    f.from = from && day.test(from) ? from : null
    f.to = to && day.test(to) ? to : null
  }
  const status = get(p, 'status')
  if (status === 'complete' || status === 'partial') f.status = status
  f.version = versionOf(get(p, 'version'))
  const identity = get(p, 'identity')
  if (identity === 'token' || identity === 'identified' || identity === 'anonymous') f.identity = identity
  f.lead = list(p, 'lead').filter((s) => (LEAD as readonly string[]).includes(s))
  f.tags = list(p, 'tags').map((t) => t.slice(0, 60))
  f.owners = list(p, 'owner').filter((s) => uuid.safeParse(s).success)
  const mk = get(p, 'mk')?.trim()
  const mv = get(p, 'mv')?.trim()
  if (mk && META_KEY.test(mk) && mv) f.meta = { key: mk, value: mv.slice(0, 200) }
  const q = get(p, 'q')?.trim()
  if (q && q.length >= TEXT_MIN) f.text = q.slice(0, TEXT_MAX)
  return f
}

/**
 * The JSON body form of the same filters (bulk export). Values are strings or
 * string lists, exactly like the URL, so both go through one parser.
 */
export const resultsFiltersInput = z.record(z.string(), z.union([z.string().max(4000), z.array(z.string().max(200)).max(100)]))

export function parseResultsFiltersObject(o: unknown): ResultsFilters {
  const r = resultsFiltersInput.safeParse(o ?? {})
  return parseResultsFilters(r.success ? r.data : {})
}

/** Back to a query string, defaults omitted. */
export function resultsFiltersToQuery(f: ResultsFilters): string {
  const q = new URLSearchParams()
  if (f.surveys.length) q.set('surveys', f.surveys.join(','))
  if (f.range !== 'all') q.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) q.set('from', f.from)
    if (f.to) q.set('to', f.to)
  }
  if (f.status !== 'all') q.set('status', f.status)
  if (f.version !== 'all') q.set('version', typeof f.version === 'number' ? `v${f.version}` : f.version)
  if (f.identity !== 'all') q.set('identity', f.identity)
  if (f.lead.length) q.set('lead', f.lead.join(','))
  if (f.tags.length) q.set('tags', f.tags.join(','))
  if (f.owners.length) q.set('owner', f.owners.join(','))
  if (f.meta) {
    q.set('mk', f.meta.key)
    q.set('mv', f.meta.value)
  }
  if (f.text) q.set('q', f.text)
  return q.toString()
}

/** One equality condition PostgREST applies on top of filtered_responses. */
export type RowCondition = { column: string; value: string }

/** Everything one survey's read needs: the filtered_responses jsonb plus post conditions. */
export type ResultsSqlQuery = {
  /** filtered_responses p_filters (migration 0018). */
  rpc: Record<string, unknown>
  /** Extra `eq` conditions on the returned rows (partial status, metadata). */
  where: RowCondition[]
  /** Open-text search, an ilike substring over answers.value_text. */
  text: string | null
}

export type VersionRef = { id: string; version_no: number }

/**
 * The version argument for one survey: 'all', 'latest', the id of the
 * requested version number, or null when the survey has no such version (the
 * survey is skipped).
 */
export function versionArgFor(f: ResultsFilters, versions: VersionRef[]): string | null {
  if (f.version === 'all' || f.version === 'latest') return f.version
  return versions.find((v) => v.version_no === f.version)?.id ?? null
}

/** PostgREST column path for a metadata key: utm keys are top level, hidden params under `hidden`. */
export function metadataColumn(key: string): string | null {
  if (!META_KEY.test(key)) return null
  return key.startsWith('hidden.') ? `metadata->hidden->>${key.slice('hidden.'.length)}` : `metadata->>${key}`
}

/**
 * Filters to the per-survey query (Results hub and bulk export). Returns null
 * when the survey cannot match (it lacks the requested version).
 */
export function toResultsQuery(f: ResultsFilters, versions: VersionRef[], now: Date = new Date()): ResultsSqlQuery | null {
  const version = versionArgFor(f, versions)
  if (version === null) return null
  const w = dateWindow({ ...DEFAULT_FILTERS, range: f.range, from: f.from, to: f.to }, now)
  const rpc: Record<string, unknown> = {
    version,
    // filtered_responses knows complete or all; partial is a row condition.
    status: f.status === 'complete' ? 'complete' : 'all',
    identity: f.identity,
  }
  if (w.from) rpc.from = w.from
  if (w.to) rpc.to = w.to
  if (f.lead.length || f.tags.length || f.owners.length) {
    rpc.contact = {
      ...(f.lead.length ? { lead_status: f.lead } : {}),
      ...(f.tags.length ? { tags: f.tags } : {}),
      ...(f.owners.length ? { owner_ids: f.owners } : {}),
    }
  }
  const where: RowCondition[] = []
  if (f.status === 'partial') where.push({ column: 'status', value: 'partial' })
  if (f.meta) {
    const col = metadataColumn(f.meta.key)
    if (col) where.push({ column: col, value: f.meta.value })
  }
  return { rpc, where, text: f.text }
}

/** True when any filter beyond surveys is set (the UI offers a reset). */
export function hasResultsFilter(f: ResultsFilters): boolean {
  return resultsFiltersToQuery({ ...f, surveys: [] }) !== ''
}
