import { choiceIdsOf } from './aggregate'
import { pct } from './stats'
import type { AnswerLite } from './types'

/**
 * Cross-tab (doc 04 section 4.3): rows are one choice question's options,
 * columns another's; cells hold count and column percent. Multi-select
 * answers count once per selected option on either axis.
 */
export type CrossTab = {
  rows: { id: string; label: string }[]
  columns: { id: string; label: string }[]
  /** counts[row][column] */
  counts: number[][]
  /** columnPct[row][column]: count / column total, percent. */
  columnPct: number[][]
  columnTotals: number[]
  /** Responses that answered both questions. */
  n: number
}

type Opt = { id: string; label: string }

export function crossTab(rowOptions: Opt[], rowAnswers: AnswerLite[], colOptions: Opt[], colAnswers: AnswerLite[]): CrossTab {
  const ri = new Map(rowOptions.map((o, i) => [o.id, i]))
  const ci = new Map(colOptions.map((o, i) => [o.id, i]))
  const colByResponse = new Map<string, string[]>()
  for (const a of colAnswers) colByResponse.set(a.response_id, choiceIdsOf(a))
  const counts = rowOptions.map(() => colOptions.map(() => 0))
  const colRespondents = colOptions.map(() => new Set<string>())
  let n = 0
  for (const a of rowAnswers) {
    const cols = colByResponse.get(a.response_id)
    const rows = choiceIdsOf(a)
    if (!cols || cols.length === 0 || rows.length === 0) continue
    n++
    for (const r of new Set(rows)) {
      const i = ri.get(r)
      if (i === undefined) continue
      for (const c of new Set(cols)) {
        const j = ci.get(c)
        if (j === undefined) continue
        counts[i]![j]!++
        colRespondents[j]!.add(a.response_id)
      }
    }
  }
  const columnTotals = colRespondents.map((s) => s.size)
  return {
    rows: rowOptions,
    columns: colOptions,
    counts,
    columnPct: counts.map((row) => row.map((c, j) => pct(c, columnTotals[j] ?? 0))),
    columnTotals,
    n,
  }
}

/** yes/no and consent are numbers in storage; give them choice ids for cross-tabs. */
export function binaryAsChoice(answers: AnswerLite[]): AnswerLite[] {
  return answers
    .filter((a) => a.value_number === 0 || a.value_number === 1)
    .map((a) => ({ ...a, value_text: String(a.value_number), value_json: null }))
}
