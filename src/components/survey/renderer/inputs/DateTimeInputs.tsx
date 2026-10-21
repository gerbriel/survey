'use client'

import { resolveDateBound, type DateQuestion, type TimeQuestion } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { asString, Hint, joinIds, textControl } from './shared'

export const DATE_FORMAT_LABEL = { MDY: 'MM/DD/YYYY', DMY: 'DD/MM/YYYY', YMD: 'YYYY-MM-DD' } as const

/** ISO date to the question's display format, for summaries. */
export function formatDate(iso: string, format: DateQuestion['settings']['display_format']): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  if (format === 'MDY') return `${mo}/${d}/${y}`
  if (format === 'DMY') return `${d}/${mo}/${y}`
  return iso
}

/**
 * Decision: the native date input. Browsers show their own locale format, so
 * display_format drives the hint and the ending summary only. No date picker library.
 */
export function DateInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<DateQuestion>) {
  const min = resolveDateBound(question.validation?.min_date, ctx.now)
  const max = resolveDateBound(question.validation?.max_date, ctx.now)
  const days = ctx.strings.weekdays.split(',')
  const disabled = (question.settings.disabled_weekdays ?? []).map((d) => days[d]).filter(Boolean)
  const hintId = `${inputId}-fmt`
  return (
    <div className="flex flex-col gap-1">
      <input
        id={inputId}
        type="date"
        className={cx(textControl, 'max-w-60')}
        value={asString(value)}
        min={min}
        max={max}
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, hintId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <Hint id={hintId}>
        {fmt(ctx.strings.dateFormat, { format: DATE_FORMAT_LABEL[question.settings.display_format] ?? DATE_FORMAT_LABEL.YMD })}
        {disabled.length > 0 ? `. ${fmt(ctx.strings.dateUnavailable, { days: disabled.join(', ') })}` : ''}
      </Hint>
    </div>
  )
}

function hhmm(mins: number | undefined): string | undefined {
  if (mins === undefined) return undefined
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export function TimeInput({ question, value, onChange, inputId, labelId, describedBy, invalid }: InputProps<TimeQuestion>) {
  const step = Math.max(1, question.settings.minute_step || 1)
  return (
    <input
      id={inputId}
      type="time"
      className={cx(textControl, 'max-w-40')}
      value={asString(value)}
      step={step * 60}
      min={hhmm(question.validation?.min)}
      max={hhmm(question.validation?.max)}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={question.required || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
