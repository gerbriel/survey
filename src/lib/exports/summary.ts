import type { QuestionBlock } from '@/lib/analytics/analyze'
import type { QuestionSummary } from '@/lib/analytics/types'

/**
 * Doc 04 section 4.1 numbers flattened to rows: the XLSX Summary sheet and
 * the aggregate CSV that viewers may download. Never verbatims or files.
 */
export const SUMMARY_HEADER = ['question_key', 'question', 'type', 'measure', 'value', 'percent']

export type SummaryRow = [string, string, string, string, string | number, string | number]

function lines(s: QuestionSummary): [string, string | number, string | number][] {
  const out: [string, string | number, string | number][] = [['answered', s.n, '']]
  switch (s.kind) {
    case 'choice':
      for (const o of s.options) out.push([o.label, o.count, o.pct])
      break
    case 'numeric':
      out.push(['mean', s.mean ?? '', ''], ['median', s.median ?? '', ''], ['min', s.min ?? '', ''], ['max', s.max ?? '', ''])
      for (const b of s.histogram) out.push([`${b.from} to ${b.to}`, b.count, ''])
      break
    case 'rating':
      out.push(['mean', s.mean ?? '', ''], ['median', s.median ?? '', ''])
      for (const d of s.distribution) out.push([String(d.value), d.count, d.pct])
      break
    case 'nps':
      out.push(['nps', s.score ?? '', ''], ['promoters', s.promoters, ''], ['passives', s.passives, ''], ['detractors', s.detractors, ''])
      break
    case 'text':
      for (const w of s.words.slice(0, 20)) out.push([`word: ${w.word}`, w.count, ''])
      break
    case 'matrix':
      s.rows.forEach((r, i) =>
        s.columns.forEach((c, j) => out.push([`${r.label}: ${c.label}`, s.cells[i]![j]!, s.rowTotals[i] ? Math.round((1000 * s.cells[i]![j]!) / s.rowTotals[i]!) / 10 : 0])),
      )
      break
    case 'ranking':
      for (const it of s.items) out.push([`${it.label}: average position`, it.avgPosition ?? '', it.firstPct])
      break
    case 'date':
      out.push(['earliest', s.earliest ?? '', ''], ['latest', s.latest ?? '', ''])
      for (const m of s.months) out.push([m.month, m.count, ''])
      break
    case 'files':
      out.push(['files', s.fileCount, ''])
      break
    case 'count':
      break
  }
  return out
}

export function summaryRows(blocks: QuestionBlock[]): SummaryRow[] {
  const rows: SummaryRow[] = []
  for (const b of blocks) {
    const q = b.question
    if (!b.summary) {
      rows.push([q.question_key, q.label, q.type, 'not combined: type changed between versions', '', ''])
      continue
    }
    for (const [m, v, p] of lines(b.summary)) rows.push([q.question_key, q.label, q.type, m, v, p])
  }
  return rows
}
