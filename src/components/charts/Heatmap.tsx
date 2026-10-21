import { ChartFrame } from './ChartFrame'
import { SEQ, SEQ_ON } from './tokens'

export type HeatCell = number | '<3'

/**
 * Heat table: a real <table> (rows x columns) whose cells are tinted on the
 * one-hue sequential blue ramp by count; the count, and an optional percent,
 * are printed in each cell with an ink that clears contrast on its step.
 */
export function Heatmap({
  title,
  description,
  rows,
  columns,
  cells,
  sub,
}: {
  title: string
  description?: string
  rows: string[]
  columns: string[]
  cells: HeatCell[][]
  /** Optional second line per cell, for example a row or column percent. */
  sub?: (string | null)[][]
}) {
  const max = Math.max(1, ...cells.flat().map((c) => (typeof c === 'number' ? c : 0)))
  return (
    <ChartFrame title={title} description={description}>
      <div className="w-full overflow-x-auto">
        <table className="viz-num border-separate text-xs" style={{ borderSpacing: 2 }}>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1" />
              {columns.map((c) => (
                <th key={c} scope="col" className="max-w-[8rem] p-1 text-left font-medium text-[var(--viz-ink-2)]">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r}-${i}`}>
                <th scope="row" className="max-w-[12rem] p-1 text-left font-medium text-[var(--viz-ink-2)]">
                  {r}
                </th>
                {columns.map((c, j) => {
                  const v = cells[i]?.[j] ?? 0
                  const step = typeof v === 'number' && v > 0 ? Math.min(6, Math.floor((v / max) * 6.999)) : -1
                  return (
                    <td
                      key={`${c}-${j}`}
                      title={`${r}, ${c}: ${v}`}
                      className="viz-fill min-w-[3.5rem] rounded px-2 py-1.5 text-right"
                      style={step >= 0 ? { background: SEQ[step], color: SEQ_ON[step] } : { background: 'var(--viz-track)', color: 'var(--viz-ink-2)' }}
                    >
                      <span className="block">{v}</span>
                      {sub?.[i]?.[j] ? <span className="block opacity-80">{sub[i]![j]}</span> : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  )
}
