import { VizStyles } from './tokens'

/**
 * Word-sized trend line for stat tiles: 2px line in the de-emphasis ink with
 * the latest point in slot 1. role="img" with a text alternative.
 */
export function Sparkline({ values, label, width = 96, height = 24 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values)
  const n = values.length
  const x = (i: number) => (n <= 1 ? width / 2 : 2 + (i / (n - 1)) * (width - 4))
  const y = (v: number) => height - 2 - (v / max) * (height - 4)
  const last = values[n - 1] ?? 0
  return (
    <span className="viz inline-block align-middle">
      <VizStyles />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${values.join(', ')}`}>
        <polyline
          fill="none"
          stroke="var(--viz-neutral)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        />
        {n > 0 ? <circle cx={x(n - 1)} cy={y(last)} r={3} fill="var(--viz-s1)" stroke="var(--viz-surface)" strokeWidth={1.5} /> : null}
      </svg>
    </span>
  )
}
