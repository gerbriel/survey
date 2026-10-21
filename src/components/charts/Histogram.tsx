import { ChartFrame } from './ChartFrame'
import { compact, niceMax } from './format'

export type HistogramDatum = { label: string; value: number }

const W = 600
const H = 200
const PAD = { left: 36, right: 8, top: 12, bottom: 28 }

/**
 * Columns from one baseline, slot 1 color, 2px surface gap between adjacent
 * bins, 4px rounded data end, hairline grid. Every column carries a <title>
 * for hover; the data table holds every value.
 */
export function Histogram({ title, description, data, xLabel = 'Bin' }: { title: string; description?: string; data: HistogramDatum[]; xLabel?: string }) {
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = data.length ? plotW / data.length : plotW
  const bw = Math.max(2, slot - 2)
  const ticks = [0, top / 2, top]
  const every = Math.max(1, Math.ceil(data.length / 8))
  const summary = data.length ? `${data.length} bins; tallest ${compact(Math.max(...data.map((d) => d.value)))}.` : 'No data.'
  return (
    <ChartFrame title={title} description={description} table={{ columns: [xLabel, 'Count'], rows: data.map((d) => [d.label, d.value]) }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`} className="h-auto w-full max-w-3xl">
        {ticks.map((t) => {
          const y = PAD.top + plotH - (t / top) * plotH
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)" className="viz-num">
                {compact(t)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const h = top ? (d.value / top) * plotH : 0
          const x = PAD.left + i * slot + 1
          const y = PAD.top + plotH - h
          const r = Math.min(4, h, bw / 2)
          return (
            <g key={`${d.label}-${i}`}>
              {h > 0 ? (
                <path
                  className="viz-mark viz-fill"
                  fill="var(--viz-s1)"
                  d={`M${x},${PAD.top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${PAD.top + plotH} Z`}
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </path>
              ) : null}
              {i % every === 0 || i === data.length - 1 ? (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                  {d.label}
                </text>
              ) : null}
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
      </svg>
    </ChartFrame>
  )
}
