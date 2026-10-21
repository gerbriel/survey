'use client'

import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx, focusRing } from './cx'
import { Field, controlClass, describedBy } from './Field'

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id?: string
  /** Visible label. Required: every input has one. */
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function Input({ id, label, hint, error, required, className, ...rest }: InputProps) {
  const generated = useId()
  const inputId = id ?? generated
  return (
    <Field id={inputId} label={label} hint={hint} error={error} required={required}>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={cx(controlClass, focusRing, className)}
        {...rest}
      />
    </Field>
  )
}
