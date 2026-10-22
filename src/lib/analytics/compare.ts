import { parseFilters, type AnalyticsFilters } from './filters'
import { MIN_CELL } from './suppress'
import type { QuestionSummary } from './types'

/**
 * Compare: two to five surveys side by side. Pure matching and aggregation,
 * unit tested; compare-load.ts does the reads.
 *
 * Matching (in order):
 *   1. question_key. Duplicated surveys and surveys made from one template
 *      keep their keys. A key present in two or more surveys with different
 *      types is refused as a whole (type mismatch) and never label matched.
 *   2. normalized label plus type, among questions step 1 left over. Two
 *      questions with the same label and a different type are refused too.
 * A matched question appears in at least two surveys; the rest are listed as
 * unmatched per survey.
 *
 * Differences are against the first survey: percentage points for shares,
 * mean delta for numbers and ratings, NPS points, average position for
 * ranking. Decision: a difference is withheld when either side has fewer
 * than MIN_CELL (3) answers; the value still shows, flagged as small.
 * Decision: an option, matrix cell or ranking item one survey does not offer
 * reads as empty there (no difference), never as 0%.
 */

export const COMPARE_MIN_SURVEYS = 2
export const COMPARE_MAX_SURVEYS = 5

export type Matchable = { question_key: string; type: string; label: string }

export type Match<T extends Matchable> = {
  /** Anchor key: the first survey's key that has the question. */
  key: string
  label: string
  type: string
  by: 'key' | 'label'
  /** One entry per survey, null where the survey lacks the question. */
  entries: (T | null)[]
}

export type Refusal = { by: 'key' | 'label'; key: string; label: string; types: (string | null)[] }

export type MatchResult<T extends Matchable> = {
  matched: Match<T>[]
  refused: Refusal[]
  /** Per survey, questions with no counterpart (refused ones included). */
  unmatched: T[][]
}

/** Lowercase, accents and punctuation stripped, whitespace collapsed. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

type Slot<T> = { item: T; survey: number; index: number }

function order<T>(a: Slot<T>[], b: Slot<T>[]): number {
  const fa = a[0]!
  const fb = b[0]!
  return fa.survey - fb.survey || fa.index - fb.index
}

export function matchQuestions<T extends Matchable>(perSurvey: T[][]): MatchResult<T> {
  const used = perSurvey.map(() => new Set<number>())
  const groups: { by: 'key' | 'label'; slots: Slot<T>[] }[] = []
  const refused: Refusal[] = []
  const typesOf = (slots: Slot<T>[]) => perSurvey.map((_, s) => slots.find((x) => x.survey === s)?.item.type ?? null)

  // 1. question_key
  const byKey = new Map<string, Slot<T>[]>()
  perSurvey.forEach((qs, s) =>
    qs.forEach((item, index) => {
      const list = byKey.get(item.question_key) ?? []
      if (!list.some((x) => x.survey === s)) list.push({ item, survey: s, index })
      byKey.set(item.question_key, list)
    }),
  )
  for (const [key, slots] of byKey) {
    if (new Set(slots.map((x) => x.survey)).size < 2) continue
    for (const x of slots) used[x.survey]!.add(x.index)
    if (new Set(slots.map((x) => x.item.type)).size > 1) {
      refused.push({ by: 'key', key, label: slots[0]!.item.label, types: typesOf(slots) })
      continue
    }
    groups.push({ by: 'key', slots })
  }

  // 2. normalized label plus type, on what is left
  const byLabel = new Map<string, Slot<T>[]>()
  perSurvey.forEach((qs, s) =>
    qs.forEach((item, index) => {
      if (used[s]!.has(index)) return
      const norm = normalizeLabel(item.label)
      if (!norm) return
      const list = byLabel.get(norm) ?? []
      list.push({ item, survey: s, index })
      byLabel.set(norm, list)
    }),
  )
  for (const slots of byLabel.values()) {
    if (new Set(slots.map((x) => x.survey)).size < 2) continue
    const byType = new Map<string, Slot<T>[]>()
    for (const x of slots) {
      const l = byType.get(x.item.type) ?? []
      if (!l.some((y) => y.survey === x.survey)) l.push(x)
      byType.set(x.item.type, l)
    }
    const spanning = [...byType.values()].filter((l) => l.length >= 2)
    if (spanning.length === 1 && byType.size === 1) {
      const l = spanning[0]!
      for (const x of l) used[x.survey]!.add(x.index)
      groups.push({ by: 'label', slots: l })
    } else {
      // Same label, different types: refuse rather than combine.
      refused.push({ by: 'label', key: slots[0]!.item.question_key, label: slots[0]!.item.label, types: typesOf(slots) })
    }
  }

  groups.sort((a, b) => order(a.slots, b.slots))
  const matched = groups.map(({ by, slots }) => {
    const first = slots[0]!.item
    return {
      key: first.question_key,
      label: first.label,
      type: first.type,
      by,
      entries: perSurvey.map((_, s) => slots.find((x) => x.survey === s)?.item ?? null),
    }
  })
  const unmatched = perSurvey.map((qs, s) => qs.filter((_, i) => !used[s]!.has(i) || refused.some((r) => r.by === 'key' && r.key === qs[i]!.question_key)))
  return { matched, refused, unmatched }
}

// ------------------------------------------------------------- aggregation

export type DeltaKind = 'pp' | 'mean' | 'nps' | 'position'

export type MeasureRow = {
  measure: string
  /** How the value reads: share in percent, a mean, an NPS score, a position, or a count. */
  unit: 'pct' | 'mean' | 'nps' | 'position' | 'count'
  values: (number | null)[]
  /** Answers behind each value (for the small cell rule). */
  ns: number[]
  /** Against the first survey; null for the first, for counts, and for small cells. */
  deltas: (number | null)[]
  delta: DeltaKind | null
}

export type QuestionComparison = {
  measures: MeasureRow[]
  /** The one number per survey the Summary sheet shows. */
  headline: MeasureRow
}

const round1 = (x: number) => Math.round(x * 10) / 10

/** Difference against the first value, withheld for small cells. */
export function deltasFor(values: (number | null)[], ns: number[], kind: DeltaKind | null): (number | null)[] {
  return values.map((v, i) => {
    if (i === 0 || kind === null) return null
    const base = values[0]
    if (v === null || base === null || base === undefined) return null
    if ((ns[0] ?? 0) < MIN_CELL || (ns[i] ?? 0) < MIN_CELL) return null
    return round1(v - base)
  })
}

export function isSmall(n: number): boolean {
  return n < MIN_CELL
}

function row(measure: string, unit: MeasureRow['unit'], values: (number | null)[], ns: number[], delta: DeltaKind | null): MeasureRow {
  return { measure, unit, values, ns, deltas: deltasFor(values, ns, delta), delta }
}

type Item = { id: string; label: string }

/** Union of items across surveys, matched by id, then by normalized label. */
function unionItems(lists: (Item[] | null)[]): { label: string; ids: (string | null)[] }[] {
  const out: { label: string; ids: (string | null)[] }[] = []
  lists.forEach((items, s) => {
    for (const it of items ?? []) {
      let hit = out.find((u) => u.ids[s] === null && u.ids.some((x) => x === it.id))
      if (!hit) hit = out.find((u) => u.ids[s] === null && normalizeLabel(u.label) === normalizeLabel(it.label))
      if (hit) hit.ids[s] = it.id
      else {
        const ids: (string | null)[] = lists.map(() => null)
        ids[s] = it.id
        out.push({ label: it.label, ids })
      }
    }
  })
  return out
}

function pick<K extends QuestionSummary['kind']>(list: (QuestionSummary | null)[], kind: K): (Extract<QuestionSummary, { kind: K }> | null)[] {
  return list.map((s) => (s && s.kind === kind ? (s as Extract<QuestionSummary, { kind: K }>) : null))
}

/**
 * Side by side numbers for one matched question. `summaries` holds one entry
 * per survey (null where the survey lacks it or refused to combine versions).
 */
export function compareSummaries(summaries: (QuestionSummary | null)[]): QuestionComparison {
  const ns = summaries.map((s) => s?.n ?? 0)
  const answered = row('answered', 'count', summaries.map((s) => (s ? s.n : null)), ns, null)
  const measures: MeasureRow[] = [answered]
  const kind = summaries.find((s) => s)?.kind
  let headline: MeasureRow = answered

  switch (kind) {
    case 'choice': {
      const list = pick(summaries, 'choice')
      const items = unionItems(list.map((s) => (s ? s.options : null)))
      const rows = items.map((it) =>
        row(
          it.label,
          'pct',
          list.map((s, i) => {
            const o = s && it.ids[i] ? s.options.find((x) => x.id === it.ids[i]) : undefined
            return o ? o.pct : null
          }),
          ns,
          'pp',
        ),
      )
      measures.push(...rows)
      // Headline: the first survey's most picked option.
      headline = [...rows].sort((a, b) => (b.values[0] ?? -1) - (a.values[0] ?? -1))[0] ?? answered
      break
    }
    case 'numeric': {
      const list = pick(summaries, 'numeric')
      headline = row('mean', 'mean', list.map((s) => s?.mean ?? null), ns, 'mean')
      measures.push(headline, row('median', 'mean', list.map((s) => s?.median ?? null), ns, 'mean'))
      break
    }
    case 'rating': {
      const list = pick(summaries, 'rating')
      headline = row('mean', 'mean', list.map((s) => s?.mean ?? null), ns, 'mean')
      measures.push(headline, row('median', 'mean', list.map((s) => s?.median ?? null), ns, 'mean'))
      const points = [...new Set(list.flatMap((s) => s?.distribution.map((d) => d.value) ?? []))].sort((a, b) => a - b)
      for (const p of points) {
        measures.push(row(`rated ${p}`, 'pct', list.map((s) => (s ? (s.distribution.find((d) => d.value === p)?.pct ?? 0) : null)), ns, 'pp'))
      }
      break
    }
    case 'nps': {
      const list = pick(summaries, 'nps')
      const share = (s: (typeof list)[number], k: 'promoters' | 'passives' | 'detractors') => (s ? (s.n ? round1((100 * s[k]) / s.n) : 0) : null)
      headline = row('nps', 'nps', list.map((s) => s?.score ?? null), ns, 'nps')
      measures.push(
        headline,
        row('promoters', 'pct', list.map((s) => share(s, 'promoters')), ns, 'pp'),
        row('passives', 'pct', list.map((s) => share(s, 'passives')), ns, 'pp'),
        row('detractors', 'pct', list.map((s) => share(s, 'detractors')), ns, 'pp'),
      )
      break
    }
    case 'matrix': {
      const list = pick(summaries, 'matrix')
      const rows = unionItems(list.map((s) => (s ? s.rows : null)))
      const cols = unionItems(list.map((s) => (s ? s.columns : null)))
      for (const r of rows) {
        for (const c of cols) {
          measures.push(
            row(
              `${r.label}: ${c.label}`,
              'pct',
              list.map((s, i) => {
                if (!s) return null
                const ri = s.rows.findIndex((x) => x.id === r.ids[i])
                const ci = s.columns.findIndex((x) => x.id === c.ids[i])
                if (ri < 0 || ci < 0) return null
                const total = s.rowTotals[ri] ?? 0
                return total ? round1((100 * (s.cells[ri]?.[ci] ?? 0)) / total) : 0
              }),
              ns,
              'pp',
            ),
          )
        }
      }
      break
    }
    case 'ranking': {
      const list = pick(summaries, 'ranking')
      const items = unionItems(list.map((s) => (s ? s.items : null)))
      const avg = items.map((it) =>
        row(`${it.label}: average position`, 'position', list.map((s, i) => (s ? (s.items.find((x) => x.id === it.ids[i])?.avgPosition ?? null) : null)), ns, 'position'),
      )
      for (const [i, it] of items.entries()) {
        measures.push(avg[i]!, row(`${it.label}: ranked first`, 'pct', list.map((s, j) => (s ? (s.items.find((x) => x.id === it.ids[j])?.firstPct ?? null) : null)), ns, 'pp'))
      }
      headline = [...avg].sort((a, b) => (a.values[0] ?? Infinity) - (b.values[0] ?? Infinity))[0] ?? answered
      break
    }
    default:
      // text, date, files, count: answered only; text shows word lists in the UI.
      break
  }
  return { measures, headline }
}

// --------------------------------------------------------------- strip

export type SurveyStrip = { responses: number; completionRate: number | null; medianSeconds: number | null }

export type StripComparison = {
  completion: (number | null)[]
  completionDelta: (number | null)[]
  median: (number | null)[]
  medianDelta: (number | null)[]
}

/** Completion rate (pp) and median time (seconds) against the first survey. */
export function compareStrip(strips: SurveyStrip[]): StripComparison {
  const ns = strips.map((s) => s.responses)
  const completion = strips.map((s) => s.completionRate)
  const median = strips.map((s) => s.medianSeconds)
  return { completion, completionDelta: deltasFor(completion, ns, 'pp'), median, medianDelta: deltasFor(median, ns, 'mean') }
}

// --------------------------------------------------------------- params

/** Survey ids from `surveys=a,b,c`, unique, at most five. */
export function parseCompareSurveys(raw: string | string[] | undefined): string[] {
  const all = ([] as string[]).concat(raw ?? []).flatMap((v) => v.split(','))
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return [...new Set(all.map((s) => s.trim()).filter((s) => uuid.test(s)))].slice(0, COMPARE_MAX_SURVEYS)
}

const PER_SURVEY = ['range', 'from', 'to', 'version'] as const

/**
 * Filters for survey i: the shared range, from, to and version, overridden
 * by range_i, from_i, to_i, version_i when given. Decision: status and
 * identity are shared only; the default status is complete, as on the
 * analytics page.
 */
export function compareFiltersFor(sp: URLSearchParams, i: number): AnalyticsFilters {
  const p = new URLSearchParams()
  for (const k of ['range', 'from', 'to', 'version', 'status', 'identity']) {
    const v = sp.get(k)
    if (v) p.set(k, v)
  }
  for (const k of PER_SURVEY) {
    const v = sp.get(`${k}_${i}`)
    if (v) p.set(k, v)
  }
  return { ...parseFilters(p), crossTab: null, answer: null }
}

// --------------------------------------------------------------- export

export type CompareTable = { header: string[]; rows: (string | number)[][] }

function cellValue(v: number | null): string | number {
  return v === null ? '' : v
}

/** Summary sheet and CSV: one row per matched question, one column per survey, then deltas. */
export function compareSummaryTable(titles: string[], matched: { key: string; label: string; type: string; by: string; comparison: QuestionComparison }[]): CompareTable {
  const header = ['question_key', 'question', 'type', 'matched_by', 'measure', ...titles, ...titles.slice(1).map((t) => `difference ${t}`)]
  const rows = matched.map((m) => [
    m.key,
    m.label,
    m.type,
    m.by,
    m.comparison.headline.measure,
    ...m.comparison.headline.values.map(cellValue),
    ...m.comparison.headline.deltas.slice(1).map(cellValue),
  ])
  return { header, rows }
}

/** Detail sheet: every measure of every matched question. */
export function compareDetailTable(titles: string[], matched: { key: string; label: string; comparison: QuestionComparison }[]): CompareTable {
  const header = ['question_key', 'question', 'measure', 'unit', ...titles, ...titles.slice(1).map((t) => `difference ${t}`)]
  const rows = matched.flatMap((m) =>
    m.comparison.measures.map((r) => [m.key, m.label, r.measure, r.unit, ...r.values.map(cellValue), ...r.deltas.slice(1).map(cellValue)]),
  )
  return { header, rows }
}

/** Formats a delta for the UI: sign, unit word. */
export function formatDelta(d: number | null, kind: DeltaKind | null): string {
  if (d === null || kind === null) return ''
  const sign = d > 0 ? '+' : ''
  const v = d.toLocaleString('en-US', { maximumFractionDigits: 1 })
  switch (kind) {
    case 'pp':
      return `${sign}${v} pts`
    case 'nps':
      return `${sign}${v} NPS`
    case 'position':
      return `${sign}${v} places`
    default:
      return `${sign}${v}`
  }
}
