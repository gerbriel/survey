import type { ReactNode } from 'react'
import { VizStyles } from './tokens'

/**
 * Stat tile: label (sentence case, no colon), value in the system sans with
 * proportional figures, optional delta vs a named period and a trend. The
 * delta carries a word and a sign, never color alone.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  trend,
}: {
  label: string
  value: string
  sub?: ReactNode
  delta?: { value: number; period: string; upIsGood?: boolean }
  trend?: ReactNode
}) {
  let deltaText: string | null = null
  let tone = 'text-muted'
  if (delta) {
    const up = delta.value > 0
    const same = delta.value === 0
    deltaText = same ? `No change vs ${delta.period}` : `${up ? '+' : ''}${delta.value.toLocaleString('en-US')} vs ${delta.period}`
    if (!same) tone = (up === (delta.upIsGood ?? true)) ? 'text-success' : 'text-danger'
  }
  return (
    <div className="viz flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <VizStyles />
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold text-fg">{value}</span>
      {deltaText ? <span className={`text-xs ${tone}`}>{deltaText}</span> : null}
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
      {trend ? <span className="mt-1">{trend}</span> : null}
    </div>
  )
}
