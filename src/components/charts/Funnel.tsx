import { ChartFrame } from './ChartFrame'
import { compact, percent } from './format'

export type FunnelStage = { label: string; value: number | null }

const ORD = ['var(--viz-ord-1)', 'var(--viz-ord-2)', 'var(--viz-ord-3)']

/**
 * Ordered stages (views, starts, completes) as horizontal bars on the
 * ordinal blue ramp, each with its count and conversion from the stage
 * before. Suppressed counts (null) print "<3".
 */
export function Funnel({ title, description, stages }: { title: string; description?: string; stages: FunnelStage[] }) {
  const top = Math.max(1, ...stages.map((s) => s.value ?? 0))
  return (
    <ChartFrame
      title={title}
      description={description}
      table={{ columns: ['Stage', 'Count'], rows: stages.map((s) => [s.label, s.value === null ? '<3' : s.value]) }}
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1]!.value : null
          const conv = i > 0 && prev && s.value !== null ? ` (${percent((100 * s.value) / prev)} of ${stages[i - 1]!.label.toLowerCase()})` : ''
          const w = s.value === null ? 0 : (100 * s.value) / top
          return (
            <li key={s.label} className="grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-3 text-sm">
              <span className="text-[var(--viz-ink-2)]">{s.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                {w > 0 ? (
                  <span
                    aria-hidden="true"
                    title={`${s.label}: ${s.value}`}
                    className="viz-mark viz-fill block h-4 shrink-0 rounded-r"
                    style={{ width: `${w}%`, maxWidth: 'calc(100% - 9rem)', background: ORD[Math.min(i, ORD.length - 1)] }}
                  />
                ) : null}
                <span className="viz-num shrink-0 text-xs">
                  {s.value === null ? '<3' : compact(s.value)}
                  <span className="text-[var(--viz-muted)]">{conv}</span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </ChartFrame>
  )
}
