import type { Theme } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import { fmt, type RendererStrings } from './strings'

/**
 * Progress in the Theme's style (doc 03 section 8). Every visible style
 * carries "Step n of m" text and role="progressbar" (doc 02 section 11).
 */
export function Progress({
  style,
  current,
  total,
  strings,
}: {
  style: Theme['progress']['style']
  current: number
  total: number
  strings: RendererStrings
}) {
  if (style === 'none' || total <= 0) return null
  const safeTotal = Math.max(1, total)
  const cur = Math.min(Math.max(1, current), safeTotal)
  const percent = Math.round((cur / safeTotal) * 100)
  const stepText = fmt(strings.stepOf, { current: cur, total: safeTotal })
  const percentText = fmt(strings.percentComplete, { percent })
  const bar = {
    role: 'progressbar' as const,
    'aria-label': strings.progressLabel,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': percent,
    'aria-valuetext': `${stepText}, ${percentText}`,
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-[var(--sv-on-background)]">{style === 'percent' ? percentText : stepText}</p>
      {style === 'steps' ? (
        <div {...bar} className="flex gap-1">
          {Array.from({ length: safeTotal }, (_, i) => (
            <span key={i} className={cx('h-2 flex-1 rounded-full', i < cur ? 'bg-[var(--sv-primary)]' : 'bg-[color-mix(in_srgb,var(--sv-on-background)_15%,transparent)]')} />
          ))}
        </div>
      ) : (
        <div {...bar} className="h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--sv-on-background)_15%,transparent)]">
          <div className="h-full rounded-full bg-[var(--sv-primary)] motion-safe:transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}
