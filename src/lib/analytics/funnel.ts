import { median, pct, round } from './stats'
import type { EventLite, QuestionSnapshot, ResponseLite } from './types'

/**
 * Funnel metrics from events (doc 04 section 4.2). Pure. Event metrics honor
 * date and version only; callers pass events already scoped to both.
 */

export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000

export type Funnel = {
  views: number
  starts: number
  completes: number
  /** start without complete that sent abandon or is older than 24 hours. */
  abandoned: number
  /** completes / starts, percent. */
  completionRate: number
  /** starts / views, percent. */
  startRate: number
}

export function computeFunnel(events: EventLite[], now: number = Date.now()): Funnel {
  const viewed = new Set<string>()
  const started = new Map<string, number>()
  const completed = new Set<string>()
  const abandonSent = new Set<string>()
  const lastSeen = new Map<string, number>()
  for (const e of events) {
    const rid = e.respondent_hash
    if (!rid) continue
    const t = Date.parse(e.occurred_at)
    if (Number.isFinite(t)) lastSeen.set(rid, Math.max(lastSeen.get(rid) ?? 0, t))
    if (e.type === 'view') viewed.add(rid)
    else if (e.type === 'start') started.set(rid, Math.min(started.get(rid) ?? Infinity, t))
    else if (e.type === 'complete') completed.add(rid)
    else if (e.type === 'abandon') abandonSent.add(rid)
  }
  let completes = 0
  let abandoned = 0
  for (const rid of started.keys()) {
    if (completed.has(rid)) completes++
    else if (abandonSent.has(rid) || now - (lastSeen.get(rid) ?? 0) >= ABANDON_AFTER_MS) abandoned++
  }
  return {
    views: viewed.size,
    starts: started.size,
    completes,
    abandoned,
    completionRate: pct(completes, started.size),
    startRate: pct(started.size, viewed.size),
  }
}

export type DropOffRow = {
  question_key: string
  label: string
  position: number
  reached: number
  droppedHere: number
}

/**
 * For each rid that started, its furthest question viewed; then per question
 * how many reached it and how many stopped there without completing. Branching
 * means this is "reached", not a strict funnel.
 */
export function dropOffByQuestion(events: EventLite[], questions: Pick<QuestionSnapshot, 'question_key' | 'label' | 'position'>[]): DropOffRow[] {
  const pos = new Map(questions.map((q) => [q.question_key, q.position]))
  const state = new Map<string, { started: boolean; completed: boolean; last: number | null }>()
  for (const e of events) {
    const rid = e.respondent_hash
    if (!rid || !(e.type === 'start' || e.type === 'question_view' || e.type === 'complete')) continue
    const s = state.get(rid) ?? { started: false, completed: false, last: null }
    if (e.type === 'start') s.started = true
    if (e.type === 'complete') s.completed = true
    if (e.type === 'question_view' && e.question_key) {
      const p = pos.get(e.question_key)
      if (p !== undefined) s.last = s.last === null ? p : Math.max(s.last, p)
    }
    state.set(rid, s)
  }
  const reachedList = [...state.values()].filter((s) => s.started)
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      question_key: q.question_key,
      label: q.label,
      position: q.position,
      reached: reachedList.filter((s) => s.last !== null && s.last >= q.position).length,
      droppedHere: reachedList.filter((s) => s.last === q.position && !s.completed).length,
    }))
}

export type PageDropOffRow = { page: number; reached: number; droppedHere: number }

/** Same as dropOffByQuestion, grouped by meta.page of question_view events (0 based). */
export function dropOffByPage(events: EventLite[]): PageDropOffRow[] {
  const state = new Map<string, { started: boolean; completed: boolean; last: number | null }>()
  let maxPage = -1
  for (const e of events) {
    const rid = e.respondent_hash
    if (!rid) continue
    const s = state.get(rid) ?? { started: false, completed: false, last: null }
    if (e.type === 'start') s.started = true
    if (e.type === 'complete') s.completed = true
    if (e.type === 'question_view') {
      const p = Number(e.meta.page)
      if (Number.isInteger(p) && p >= 0 && p < 500) {
        s.last = s.last === null ? p : Math.max(s.last, p)
        maxPage = Math.max(maxPage, p)
      }
    }
    state.set(rid, s)
  }
  const list = [...state.values()].filter((s) => s.started)
  const out: PageDropOffRow[] = []
  for (let p = 0; p <= maxPage; p++) {
    out.push({
      page: p,
      reached: list.filter((s) => s.last !== null && s.last >= p).length,
      droppedHere: list.filter((s) => s.last === p && !s.completed).length,
    })
  }
  return out
}

/** Median seconds from started_at to submitted_at over complete responses. */
export function medianTimeToComplete(responses: Pick<ResponseLite, 'status' | 'started_at' | 'submitted_at'>[]): number | null {
  const secs: number[] = []
  for (const r of responses) {
    if (r.status !== 'complete' || !r.submitted_at) continue
    const d = (Date.parse(r.submitted_at) - Date.parse(r.started_at)) / 1000
    if (Number.isFinite(d) && d >= 0) secs.push(d)
  }
  const m = median(secs)
  return m === null ? null : round(m)
}

export type TimePoint = { bucket: string; complete: number; partial: number }

function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** Monday of the UTC week holding t, as YYYY-MM-DD. */
export function weekKey(t: number): string {
  const d = new Date(t)
  const dow = (d.getUTCDay() + 6) % 7
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow))
}

/**
 * Responses per day, or per week (Monday start) when the range exceeds 90
 * days. Complete responses bucket by submitted_at, partials by started_at.
 * Empty buckets are filled so the line is continuous.
 */
export function responsesOverTime(
  responses: Pick<ResponseLite, 'status' | 'started_at' | 'submitted_at'>[],
  range: { from?: string | null; to?: string | null } = {},
): { unit: 'day' | 'week'; points: TimePoint[] } {
  const times = responses.map((r) => Date.parse(r.submitted_at ?? r.started_at)).filter(Number.isFinite)
  if (times.length === 0 && !range.from) return { unit: 'day', points: [] }
  const from = range.from ? Date.parse(range.from) : Math.min(...times)
  const to = range.to ? Math.min(Date.parse(range.to), Date.now()) : Math.max(...times, from)
  const unit: 'day' | 'week' = to - from > 90 * 86400000 ? 'week' : 'day'
  const key = unit === 'week' ? weekKey : dayKey
  const map = new Map<string, TimePoint>()
  const step = unit === 'week' ? 7 * 86400000 : 86400000
  const start = Date.parse(key(from))
  for (let t = start; t <= to && map.size < 2000; t += step) map.set(key(t), { bucket: key(t), complete: 0, partial: 0 })
  for (const r of responses) {
    const t = Date.parse(r.status === 'complete' && r.submitted_at ? r.submitted_at : r.started_at)
    if (!Number.isFinite(t)) continue
    const k = key(t)
    const p = map.get(k) ?? { bucket: k, complete: 0, partial: 0 }
    if (r.status === 'complete') p.complete++
    else p.partial++
    map.set(k, p)
  }
  return { unit, points: [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)) }
}

export type DeviceSplit = { device: 'mobile' | 'tablet' | 'desktop' | 'unknown'; count: number; pct: number }[]

const DEVICES = ['desktop', 'mobile', 'tablet', 'unknown'] as const

function split(values: unknown[]): DeviceSplit {
  const c = new Map<string, number>()
  for (const v of values) {
    const d = v === 'mobile' || v === 'tablet' || v === 'desktop' ? v : 'unknown'
    c.set(d, (c.get(d) ?? 0) + 1)
  }
  return DEVICES.map((device) => ({ device, count: c.get(device) ?? 0, pct: pct(c.get(device) ?? 0, values.length) })).filter(
    (d) => d.count > 0,
  )
}

/** metadata.device on complete responses. */
export function deviceSplitResponses(responses: Pick<ResponseLite, 'status' | 'metadata'>[]): DeviceSplit {
  return split(responses.filter((r) => r.status === 'complete').map((r) => r.metadata.device))
}

/** meta.device on view events, one per rid. */
export function deviceSplitViews(events: EventLite[]): DeviceSplit {
  const seen = new Map<string, unknown>()
  for (const e of events) if (e.type === 'view' && e.respondent_hash && !seen.has(e.respondent_hash)) seen.set(e.respondent_hash, e.meta.device)
  return split([...seen.values()])
}
