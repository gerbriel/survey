'use client'

import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cx, focusRing } from './cx'
import { Field, controlClass, describedBy } from './Field'

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id?: string
  label: ReactNode
  options: SelectOption[]
  /** Optional first option with an empty value. */
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
}

/** Native select: keyboard and screen reader behavior come for free. */
export function Select({ id, label, options, placeholder, hint, error, required, className, ...rest }: SelectProps) {
  const generated = useId()
  const selectId = id ?? generated
  return (
    <Field id={selectId} label={label} hint={hint} error={error} required={required}>
      <select
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(selectId, hint, error)}
        className={cx(controlClass, focusRing, className)}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
