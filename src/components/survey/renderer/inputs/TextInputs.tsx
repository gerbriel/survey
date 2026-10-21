'use client'

import type {
  EmailQuestion,
  LongTextQuestion,
  NumberQuestion,
  PhoneQuestion,
  ShortTextQuestion,
} from '@/lib/survey'
import { Input } from '@/components/ui/Input'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { asString, Hint, joinIds, textControl } from './shared'

export function ShortTextInput({ question, value, onChange, inputId, labelId, describedBy, invalid }: InputProps<ShortTextQuestion>) {
  const max = question.validation?.max_length
  const mask = question.settings.mask
  return (
    <input
      id={inputId}
      type="text"
      className={textControl}
      value={asString(value)}
      placeholder={question.settings.placeholder ?? mask}
      maxLength={max}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={question.required || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function LongTextInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<LongTextQuestion>) {
  const text = asString(value)
  const max = question.validation?.max_length
  const counterId = `${inputId}-count`
  return (
    <div className="flex flex-col gap-1">
      <textarea
        id={inputId}
        className={cx(textControl, 'h-auto min-h-24 py-2')}
        rows={question.settings.rows ?? 4}
        value={text}
        placeholder={question.settings.placeholder}
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, max !== undefined && counterId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {max !== undefined ? (
        <p id={counterId} className={cx('self-end text-xs', text.length > max ? 'text-danger' : 'text-muted')}>
          {fmt(ctx.strings.characters, { count: text.length, max })}
        </p>
      ) : null}
    </div>
  )
}

function emailParts(value: unknown): { email: string; confirm: string } {
  if (typeof value === 'string') return { email: value, confirm: '' }
  if (value && typeof value === 'object') {
    const o = value as { email?: unknown; confirm?: unknown }
    return { email: asString(o.email), confirm: asString(o.confirm) }
  }
  return { email: '', confirm: '' }
}

export function EmailInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<EmailQuestion>) {
  const parts = emailParts(value)
  const confirm = question.settings.confirm === true
  const emit = (email: string, conf: string) => onChange(confirm ? (email === '' && conf === '' ? undefined : { email, confirm: conf }) : email)
  return (
    <div className="flex flex-col gap-3">
      <input
        id={inputId}
        type="email"
        autoComplete="email"
        inputMode="email"
        className={textControl}
        value={parts.email}
        placeholder={question.settings.placeholder}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => emit(e.target.value, parts.confirm)}
      />
      {confirm ? (
        <Input
          id={`${inputId}-confirm`}
          label={ctx.strings.confirmEmail}
          type="email"
          autoComplete="off"
          className="h-11 text-base rounded-[var(--sv-radius)]"
          value={parts.confirm}
          aria-invalid={invalid || undefined}
          onChange={(e) => emit(parts.email, e.target.value)}
        />
      ) : null}
    </div>
  )
}

export function PhoneInput({ question, value, onChange, inputId, labelId, describedBy, invalid }: InputProps<PhoneQuestion>) {
  const hintId = `${inputId}-fmt`
  const nanp = question.settings.default_country === 'US' || question.settings.default_country === 'CA'
  return (
    <div className="flex flex-col gap-1">
      <input
        id={inputId}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        className={textControl}
        value={asString(value)}
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, hintId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Decision: a format hint instead of a country picker; numbers outside US and CA need a leading + (normalize.toE164). */}
      <Hint id={hintId}>{nanp ? 'Example: (555) 123-4567 or +44 20 7946 0958' : 'Include the country code, for example +44 20 7946 0958'}</Hint>
    </div>
  )
}

export function NumberInput({ question, value, onChange, inputId, labelId, describedBy, invalid }: InputProps<NumberQuestion>) {
  const { prefix, suffix, decimals } = question.settings
  const affixId = `${inputId}-affix`
  const integer = question.validation?.integer === true || decimals === 0
  return (
    <div className="flex items-center gap-2">
      {prefix ? (
        <span aria-hidden="true" className="text-muted">
          {prefix}
        </span>
      ) : null}
      {/* Decision: type="text" with inputMode, so partial entries like "1." stay as typed; the validator checks the number. */}
      <input
        id={inputId}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        className={cx(textControl, 'max-w-60')}
        value={asString(value)}
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, (prefix || suffix) && affixId)}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix ? (
        <span aria-hidden="true" className="text-muted">
          {suffix}
        </span>
      ) : null}
      {prefix || suffix ? (
        <span id={affixId} className="sr-only">
          {[prefix && `Prefix ${prefix}`, suffix && `Suffix ${suffix}`].filter(Boolean).join('. ')}
        </span>
      ) : null}
    </div>
  )
}
