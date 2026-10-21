import type { ReactNode } from 'react'

/** Label, control, hint and error wired together by id. Used by Input and Select. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function describedBy(id: string, hint?: ReactNode, error?: ReactNode): string | undefined {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

export const controlClass =
  'h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted disabled:opacity-50 aria-[invalid=true]:border-danger'
