'use client'

import { useId, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Field, controlClass, describedBy } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { cx, focusRing } from '@/components/ui/cx'

/** Small form controls the ui kit does not ship (checkbox, textarea, number). */

export function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className={cx('h-4 w-4 rounded border-border', focusRing)}
        />
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="pl-6 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(controlClass, 'h-auto py-2', focusRing, className)}
        {...rest}
      />
    </Field>
  )
}

/** Number input that reports undefined for an empty box. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  disabled,
}: {
  label: ReactNode
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <Input
      label={label}
      type="number"
      inputMode="decimal"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      hint={hint}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(undefined)
        const n = Number(raw)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
      <legend className="pr-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Comma separated list in a text box. */
export function listToText(v: string[] | undefined): string {
  return (v ?? []).join(', ')
}
export function textToList(s: string): string[] | undefined {
  const out = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return out.length ? out : undefined
}
