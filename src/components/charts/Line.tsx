import { ChartFrame } from './ChartFrame'
import { compact, niceMax } from './format'
import { SERIES } from './tokens'

export type LineSeries = { name: string; values: number[] }

const W = 640
const H = 220
const PAD = { left: 40, right: 12, top: 12, bottom: 28 }

/**
 * Time series: 2px lines, round joins, end dot with a 2px surface ring, one
 * axis, hairline grid, legend for 2 or more series. Each x position has a
 * full-height hit band whose <title> lists every series at that x.
 */
export function Line({ title, description, labels, series }: { title: string; description?: string; labels: string[]; series: LineSeries[] }) {
  const n = labels.length
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const every = Math.max(1, Math.ceil(n / 6))
  const totals = series.map((s) => `${s.name} ${s.values.reduce((a, b) => a + b, 0)}`).join(', ')
  return (
    <ChartFrame
      title={title}
      description={description}
      table={{ columns: ['Period', ...series.map((s) => s.name)], rows: labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? 0)]) }}
    >
      {series.length > 1 ? (
        <ul className="m-0 flex list-none gap-4 p-0 text-xs text-[var(--viz-ink-2)]" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES[i] }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${n} periods from ${labels[0] ?? ''} to ${labels[n - 1] ?? ''}. Totals: ${totals}.`} className="h-auto w-full">
        {[0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)" className="viz-num">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={SERIES[si]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            {n > 0 ? <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={SERIES[si]} stroke="var(--viz-surface)" strokeWidth={2} /> : null}
          </g>
        ))}
        {labels.map((l, i) => (
          <rect key={`hit-${i}`} x={x(i) - plotW / Math.max(1, n) / 2} y={PAD.top} width={Math.max(24, plotW / Math.max(1, n))} height={plotH} fill="transparent" className="viz-mark">
            <title>{`${l}: ${series.map((s) => `${s.values[i] ?? 0} ${s.name.toLowerCase()}`).join(', ')}`}</title>
          </rect>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
      </svg>
    </ChartFrame>
  )
}
