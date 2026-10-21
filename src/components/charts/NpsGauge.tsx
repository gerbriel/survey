import { ChartFrame } from './ChartFrame'
import { percent } from './format'

/**
 * NPS: the score as the hero figure on a -100 to 100 arc, then a diverging
 * 100% bar: detractors (red pole), passives (neutral gray midpoint),
 * promoters (blue pole). Counts are always printed in the legend, so color
 * never carries meaning alone.
 */
export function NpsGauge({
  title,
  description,
  score,
  promoters,
  passives,
  detractors,
}: {
  title: string
  description?: string
  score: number | null
  promoters: number
  passives: number
  detractors: number
}) {
  const n = promoters + passives + detractors
  const segs = [
    { label: 'Detractors (0 to 6)', value: detractors, color: 'var(--viz-neg)' },
    { label: 'Passives (7 to 8)', value: passives, color: 'var(--viz-neutral)' },
    { label: 'Promoters (9 to 10)', value: promoters, color: 'var(--viz-s1)' },
  ]
  // Arc from 180 deg (-100) to 0 deg (100).
  const R = 70
  const cx = 90
  const cy = 84
  const angle = Math.PI * (1 - ((score ?? 0) + 100) / 200)
  const px = cx + R * Math.cos(angle)
  const py = cy - R * Math.sin(angle)
  const large = 0
  return (
    <ChartFrame
      title={title}
      description={description}
      table={{ columns: ['Group', 'Count', 'Percent'], rows: segs.map((s) => [s.label, s.value, percent(n ? (100 * s.value) / n : 0)]) }}
    >
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 180 100" width={180} height={100} role="img" aria-label={`NPS ${score ?? 'not available'} on a scale from -100 to 100, from ${n} answers.`}>
          <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} fill="none" stroke="var(--viz-track)" strokeWidth={10} strokeLinecap="round" />
          {score !== null ? (
            <>
              <path d={`M${cx},${cy - R} A${R},${R} 0 ${large} ${score >= 0 ? 1 : 0} ${px},${py}`} fill="none" stroke={score >= 0 ? 'var(--viz-s1)' : 'var(--viz-neg)'} strokeWidth={10} strokeLinecap="round" />
              <circle cx={px} cy={py} r={6} fill={score >= 0 ? 'var(--viz-s1)' : 'var(--viz-neg)'} stroke="var(--viz-surface)" strokeWidth={2} />
            </>
          ) : null}
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize={28} fontWeight={600} fill="var(--viz-ink)">
            {score === null ? 'No data' : score > 0 ? `+${score}` : String(score)}
          </text>
          <text x={cx - R} y={cy + 14} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
            -100
          </text>
          <text x={cx + R} y={cy + 14} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
            100
          </text>
        </svg>
        <div className="flex min-w-[14rem] flex-1 flex-col gap-2">
          <span aria-hidden="true" className="flex h-4 w-full gap-[2px] overflow-hidden rounded">
            {n === 0 ? <span className="block h-full w-full" style={{ background: 'var(--viz-track)' }} /> : null}
            {segs.map((s) =>
              s.value > 0 ? (
                <span key={s.label} title={`${s.label}: ${s.value}`} className="viz-mark viz-fill block h-full" style={{ flexGrow: s.value, flexBasis: 0, background: s.color }} />
              ) : null,
            )}
          </span>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-[var(--viz-ink-2)]">
            {segs.map((s) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="viz-fill inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}: <span className="viz-num text-[var(--viz-ink)]">{s.value}</span> ({percent(n ? (100 * s.value) / n : 0)})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ChartFrame>
  )
}
