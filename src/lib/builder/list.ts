/**
 * Bulk actions on the surveys list: input cleanup, the per-survey loop and
 * the result aggregation. Pure apart from the callback, unit tested. The
 * server actions in ./actions call these.
 */

export interface BulkItem {
  surveyId: string
  ok: boolean
  /** Plain copy for a failure. */
  message?: string
  /** Duplicate: the new survey id. */
  newId?: string
}

export interface BulkResult {
  succeeded: number
  failed: number
  items: BulkItem[]
}

/** Decision: at most 100 surveys per bulk action; workspaces hold tens. */
export const BULK_MAX = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Unique, well formed ids in their original order, capped at BULK_MAX. */
export function cleanBulkIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const v of ids) {
    if (typeof v !== 'string' || !UUID.test(v)) continue
    const id = v.toLowerCase()
    if (!out.includes(id)) out.push(id)
    if (out.length === BULK_MAX) break
  }
  return out
}

export function aggregateBulk(items: BulkItem[]): BulkResult {
  const succeeded = items.filter((i) => i.ok).length
  return { succeeded, failed: items.length - succeeded, items }
}

/** Runs `fn` for each id one after another, so one failure never stops the rest. A thrown error becomes that survey's failure. */
export async function runBulk(ids: string[], fn: (id: string) => Promise<Omit<BulkItem, 'surveyId'>>): Promise<BulkResult> {
  const items: BulkItem[] = []
  for (const surveyId of ids) {
    try {
      items.push({ surveyId, ...(await fn(surveyId)) })
    } catch {
      items.push({ surveyId, ok: false, message: 'Something went wrong.' })
    }
  }
  return aggregateBulk(items)
}

/** Toast copy for a finished bulk action. `verb` is past tense: "duplicated", "archived". */
export function bulkSummary(r: BulkResult, verb: string): { text: string; tone: 'success' | 'error' } {
  const n = (k: number) => `${k} survey${k === 1 ? '' : 's'}`
  if (r.items.length === 0) return { text: 'No surveys were selected.', tone: 'error' }
  if (r.failed === 0) return { text: `${n(r.succeeded)} ${verb}.`, tone: 'success' }
  const reasons = [...new Set(r.items.filter((i) => !i.ok).map((i) => i.message ?? 'Something went wrong.'))]
  const head = r.succeeded === 0 ? `No surveys ${verb}.` : `${n(r.succeeded)} ${verb}, ${r.failed} failed.`
  return { text: `${head} ${reasons.join(' ')}`, tone: 'error' }
}
