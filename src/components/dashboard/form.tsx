'use client'

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { Field, controlClass, describedBy } from '@/components/ui/Field'
import { cx, focusRing } from '@/components/ui/cx'
import type { ActionState } from '@/lib/admin/forms'

/**
 * Small form pieces the UI kit does not have yet (textarea, checkbox,
 * submit with pending state, status line). Shared by settings and admin.
 */

export function TextArea({
  id,
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { id?: string; label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <Field id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cx(controlClass, 'h-auto min-h-24 py-2', focusRing, className)}
        {...rest}
      />
    </Field>
  )
}

export function Checkbox({
  id,
  label,
  hint,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & { id?: string; label: ReactNode; hint?: ReactNode }) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input
        id={fieldId}
        type="checkbox"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className={cx('mt-0.5 h-4 w-4 rounded border-border', focusRing)}
        {...rest}
      />
      <div>
        <label htmlFor={fieldId} className="text-sm font-medium text-fg">
          {label}
        </label>
        {hint ? (
          <p id={`${fieldId}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Submit button that shows the pending state of its parent form. */
export function SubmitButton({ children, ...rest }: Omit<ButtonProps, 'type'>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending} {...rest}>
      {children}
    </Button>
  )
}

/** Result line for a form, announced politely (errors assertively). */
export function FormStatus({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return <p aria-live="polite" className="sr-only" />
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={cx('text-sm', state.status === 'error' ? 'text-danger' : 'text-success')}
    >
      {state.message}
    </p>
  )
}

export function fieldError(state: ActionState, name: string): string | undefined {
  return state.fieldErrors?.[name]
}
