import { ChartFrame, type DataTable } from './ChartFrame'
import { compact } from './format'

export type BarDatum = {
  label: string
  /** null renders as suppressed ("<3") with no bar. */
  value: number | null
  /** Visible text at the bar tip; defaults to the value. */
  display?: string
}

/**
 * Horizontal bars, one series, slot 1 color (dataviz: one series, one color,
 * no value ramp on nominal categories). <= 16px thick, 4px rounded data end,
 * square at the baseline, value at the tip. Text stays in ink tokens.
 */
export function Bar({
  title,
  description,
  data,
  max,
  tableColumns = ['Label', 'Value'],
  table,
}: {
  title: string
  description?: string
  data: BarDatum[]
  max?: number
  tableColumns?: [string, string]
  table?: DataTable
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0))
  return (
    <ChartFrame
      title={title}
      description={description}
      table={table ?? { columns: tableColumns, rows: data.map((d) => [d.label, d.display ?? (d.value === null ? '<3' : d.value)]) }}
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={title}>
        {data.map((d, i) => {
          const w = d.value === null ? 0 : Math.max(0, Math.min(100, (100 * d.value) / top))
          const text = d.display ?? (d.value === null ? '<3' : compact(d.value))
          return (
            <li key={`${d.label}-${i}`} className="grid grid-cols-[minmax(6rem,14rem)_1fr] items-center gap-3 text-sm">
              <span className="truncate text-[var(--viz-ink-2)]" title={d.label}>
                {d.label}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {w > 0 ? (
                  <span
                    aria-hidden="true"
                    title={`${d.label}: ${text}`}
                    className="viz-mark viz-fill block h-4 shrink-0 rounded-r"
                    style={{ width: `${w}%`, maxWidth: 'calc(100% - 5rem)', background: 'var(--viz-s1)' }}
                  />
                ) : null}
                <span className="viz-num shrink-0 text-xs text-[var(--viz-ink)]">{text}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </ChartFrame>
  )
}
