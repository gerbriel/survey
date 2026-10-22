import { StatTile, duration, percent } from '@/components/charts'
import { QuestionSummaryView } from '@/components/analytics/QuestionSummaryView'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { formatDelta, isSmall, type MeasureRow } from '@/lib/analytics/compare'
import type { ComparedQuestion, Comparison } from '@/lib/analytics/compare-load'

/**
 * Compare body: completion and median time strip, matched questions side by
 * side (each survey's summary drawn by the analytics page's own view and
 * chart components), a numbers table with differences against the first
 * survey, and the unmatched questions per survey. Server component.
 *
 * Decision (dataviz): surveys are compared as small multiples, one chart per
 * survey with the same form, not as one chart with a color per survey; the
 * palette has three categorical slots and Compare allows five surveys.
 */

const GRID: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5',
}

function valueText(v: number | null, unit: MeasureRow['unit']): string {
  if (v === null) return 'Not asked'
  switch (unit) {
    case 'pct':
      return percent(v)
    case 'count':
      return v.toLocaleString('en-US')
    default:
      return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

export function CompareStrip({ c }: { c: Comparison }) {
  const first = c.surveys[0]?.survey.title ?? 'the first survey'
  return (
    <section aria-label="Completion and time" className={`grid gap-3 ${GRID[c.surveys.length] ?? GRID[5]}`}>
      {c.surveys.map((s, i) => {
        const rate = c.strip.completion[i] ?? null
        const rd = c.strip.completionDelta[i] ?? null
        const md = c.strip.medianDelta[i] ?? null
        return (
          <div key={s.survey.id} className="flex flex-col gap-2">
            <h3 className="truncate text-sm font-semibold text-fg" title={s.survey.title}>
              {s.survey.title}
            </h3>
            <StatTile
              label="Completion rate"
              value={rate === null ? 'No data' : percent(rate)}
              sub={`${s.analytics.responseCount.toLocaleString('en-US')} responses${rd !== null ? `, ${formatDelta(rd, 'pp')} vs ${first}` : ''}`}
            />
            <StatTile
              label="Median time to complete"
              value={duration(c.strip.median[i] ?? null)}
              sub={md !== null ? `${md > 0 ? '+' : md < 0 ? '-' : ''}${duration(Math.abs(md))} vs ${first}` : undefined}
            />
          </div>
        )
      })}
    </section>
  )
}

function NumbersTable({ q, titles }: { q: ComparedQuestion; titles: string[] }) {
  const rows = q.comparison.measures
  return (
    <details className="text-sm" open={rows.length <= 8}>
      <summary className="cursor-pointer text-xs text-muted hover:text-fg">Numbers and differences ({rows.length} rows)</summary>
      <div className="mt-2">
        <Table caption={`${q.label}: numbers by survey`}>
          <THead>
            <Tr>
              <Th>Measure</Th>
              {titles.map((t, i) => (
                <Th key={i} className="text-right">
                  {t}
                </Th>
              ))}
              {titles.slice(1).map((t, i) => (
                <Th key={`d${i}`} className="text-right">
                  Difference, {t}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.measure}>
                <Td>{r.measure}</Td>
                {r.values.map((v, i) => (
                  <Td key={i} className="text-right tabular-nums">
                    {valueText(v, r.unit)}
                    {v !== null && r.unit !== 'count' && isSmall(r.ns[i] ?? 0) ? <span className="text-xs text-muted"> (under 3 answers)</span> : null}
                  </Td>
                ))}
                {r.deltas.slice(1).map((d, i) => (
                  <Td key={`d${i}`} className="text-right tabular-nums">
                    {formatDelta(d, r.delta)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </details>
  )
}

export function CompareQuestions({ c }: { c: Comparison }) {
  const titles = c.surveys.map((s) => s.survey.title)
  if (!c.questions.length) return <p className="text-sm text-muted">No questions match across these surveys, by key or by label and type.</p>
  return (
    <div className="flex flex-col gap-6">
      {c.questions.map((q) => (
        <section key={q.key} aria-label={q.label} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-fg">{q.label}</h3>
            <span className="text-xs text-muted">
              {q.type.replace(/_/g, ' ')}, matched by {q.by === 'key' ? 'question key' : 'label and type'}
            </span>
          </header>
          <div className={`grid gap-3 ${GRID[c.surveys.length] ?? GRID[5]}`}>
            {q.entries.map((e, i) =>
              e ? (
                <QuestionSummaryView key={i} block={e} title={titles[i]} />
              ) : (
                <div key={i} className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
                  {titles[i]} does not ask this question.
                </div>
              ),
            )}
          </div>
          <NumbersTable q={q} titles={titles} />
        </section>
      ))}
    </div>
  )
}

export function CompareUnmatched({ c }: { c: Comparison }) {
  return (
    <section aria-label="Unmatched questions" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-fg">Unmatched questions</h2>
      {c.match.refused.length ? (
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted" role="note">
          {c.match.refused.map((r) => (
            <li key={`${r.by}-${r.key}`}>
              Not combined: &ldquo;{r.label}&rdquo; has a different type across surveys ({r.types.map((t, i) => `${c.surveys[i]?.survey.title ?? ''}: ${t ?? 'absent'}`).join('; ')}).
            </li>
          ))}
        </ul>
      ) : null}
      <div className={`grid gap-3 ${GRID[c.surveys.length] ?? GRID[5]}`}>
        {c.surveys.map((s, i) => {
          const list = c.match.unmatched[i] ?? []
          return (
            <div key={s.survey.id} className="rounded-lg border border-border p-3">
              <h3 className="truncate text-sm font-semibold text-fg">{s.survey.title}</h3>
              {list.length ? (
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
                  {list.map((q) => (
                    <li key={q.question_key}>{q.label || q.question_key}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">Every question matched.</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
