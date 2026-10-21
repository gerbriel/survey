'use client'

import type { NpsQuestion, RatingQuestion } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { joinIds } from './shared'

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const EMOJI = ['\u{1F61E}', '\u{1F641}', '\u{1F610}', '\u{1F642}', '\u{1F604}']

function glyph(display: RatingQuestion['settings']['display'], n: number, points: number, filled: boolean): string {
  if (display === 'stars') return filled ? '★' : '☆'
  if (display === 'emoji') {
    const i = points <= 1 ? 2 : Math.round(((n - 1) / (points - 1)) * (EMOJI.length - 1))
    return EMOJI[i] ?? EMOJI[2] ?? ''
  }
  return String(n)
}

const scaleCell = cx(
  'flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[var(--sv-radius)] border border-border px-2 text-lg',
  'has-[:checked]:border-[var(--sv-primary)] has-[:checked]:bg-[var(--sv-primary)] has-[:checked]:text-[var(--sv-on-primary)]',
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-2',
)

function EndLabels({ id, min, max }: { id: string; min?: string; max?: string }) {
  if (!min && !max) return null
  return (
    <p id={id} className="flex justify-between gap-4 text-sm text-muted">
      <span>{min}</span>
      <span>{max}</span>
    </p>
  )
}

export function RatingInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<RatingQuestion>) {
  const { points, display, min_label, max_label } = question.settings
  const v = asNumber(value)
  const endsId = `${inputId}-ends`
  const hasEnds = Boolean(min_label || max_label)
  if (display === 'slider') {
    const mid = Math.ceil(points / 2)
    return (
      <div className="flex flex-col gap-2">
        <input
          id={inputId}
          type="range"
          min={1}
          max={points}
          step={1}
          value={v ?? mid}
          className="h-11 w-full accent-[var(--sv-primary)]"
          aria-labelledby={labelId}
          aria-describedby={joinIds(describedBy, hasEnds && endsId)}
          aria-invalid={invalid || undefined}
          aria-valuetext={v === null ? ctx.strings.sliderUnset : fmt(ctx.strings.ratingValue, { value: v, max: points })}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <p className="text-sm text-muted" aria-hidden="true">
          {v === null ? ctx.strings.sliderUnset : fmt(ctx.strings.ratingValue, { value: v, max: points })}
        </p>
        <EndLabels id={endsId} min={min_label} max={max_label} />
      </div>
    )
  }
  const values = Array.from({ length: points }, (_, i) => i + 1)
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, hasEnds && endsId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        className="flex flex-wrap gap-2"
      >
        {values.map((n, i) => (
          <label key={n} className={scaleCell}>
            <input
              id={i === 0 ? inputId : undefined}
              type="radio"
              name={inputId}
              value={n}
              checked={v === n}
              className="sr-only"
              aria-label={fmt(ctx.strings.ratingValue, { value: n, max: points })}
              onChange={() => onChange(n)}
            />
            <span aria-hidden="true">{glyph(display, n, points, v !== null && n <= v)}</span>
          </label>
        ))}
      </div>
      <EndLabels id={endsId} min={min_label} max={max_label} />
    </div>
  )
}

export function NpsInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<NpsQuestion>) {
  const v = asNumber(value)
  const endsId = `${inputId}-ends`
  const min = question.settings.min_label ?? ctx.strings.npsLow
  const max = question.settings.max_label ?? ctx.strings.npsHigh
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, endsId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        className="grid grid-cols-6 gap-1 sm:grid-cols-11"
      >
        {Array.from({ length: 11 }, (_, n) => (
          <label key={n} className={cx(scaleCell, 'min-w-0 text-base')}>
            <input
              id={n === 0 ? inputId : undefined}
              type="radio"
              name={inputId}
              value={n}
              checked={v === n}
              className="sr-only"
              onChange={() => onChange(n)}
            />
            <span>{n}</span>
          </label>
        ))}
      </div>
      <EndLabels id={endsId} min={`0: ${min}`} max={`10: ${max}`} />
    </div>
  )
}
