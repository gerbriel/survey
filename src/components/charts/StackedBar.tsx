import { ChartFrame, type DataTable } from './ChartFrame'
import { percent } from './format'
import { SERIES } from './tokens'

export type Segment = { label: string; value: number; color?: string }

/**
 * Part-to-whole as 100% stacked bars, one row per group, 2px surface gaps
 * between segments, legend always shown for 2 or more segments. Colors come
 * from the fixed categorical order; past 3 segments the tail folds to
 * "Other" (validated all-pairs cap). Also stands in for `pie` (Decision: a
 * 100% bar reads part-to-whole without angle judgments).
 */
export function foldSegments(segments: Segment[], cap = SERIES.length): Segment[] {
  if (segments.length <= cap) return segments
  const sorted = [...segments].sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, cap - 1)
  const rest = sorted.slice(cap - 1).reduce((s, x) => s + x.value, 0)
  return [...head, { label: 'Other', value: rest }]
}

export function StackedBar({
  title,
  description,
  rows,
  table,
}: {
  title: string
  description?: string
  rows: { label: string; segments: Segment[] }[]
  table?: DataTable
}) {
  const legend = rows[0]?.segments ?? []
  const colorOf = (s: Segment, i: number) => s.color ?? SERIES[i] ?? 'var(--viz-neutral)'
  return (
    <ChartFrame
      title={title}
      description={description}
      table={
        table ?? {
          columns: ['Group', ...legend.map((s) => s.label)],
          rows: rows.map((r) => [r.label, ...r.segments.map((s) => s.value)]),
        }
      }
    >
      {legend.length > 1 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-[var(--viz-ink-2)]" aria-label="Legend">
          {legend.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="viz-fill inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(s, i) }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r) => {
          const total = r.segments.reduce((s, x) => s + x.value, 0)
          const desc = r.segments.map((s) => `${s.label} ${s.value} (${percent(total ? (100 * s.value) / total : 0)})`).join(', ')
          return (
            <li key={r.label} className="flex flex-col gap-1 text-sm">
              {rows.length > 1 || r.label ? <span className="text-[var(--viz-ink-2)]">{r.label}</span> : null}
              <span className="sr-only">{desc}</span>
              <span aria-hidden="true" className="flex h-4 w-full gap-[2px] overflow-hidden rounded" style={{ background: 'var(--viz-surface)' }}>
                {total === 0 ? <span className="block h-full w-full" style={{ background: 'var(--viz-track)' }} /> : null}
                {r.segments.map((s, i) =>
                  s.value > 0 ? (
                    <span
                      key={s.label}
                      title={`${s.label}: ${s.value} (${percent((100 * s.value) / total)})`}
                      className="viz-mark viz-fill block h-full"
                      style={{ flexGrow: s.value, flexBasis: 0, background: colorOf(s, i) }}
                    />
                  ) : null,
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </ChartFrame>
  )
}
