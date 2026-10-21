'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx, focusRing } from './cx'

/**
 * Modal built on the native <dialog>: focus trap, Escape to close, inert
 * background and top layer are handled by the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cx(
        'm-auto w-full max-w-lg rounded-lg border border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cx('rounded p-1 text-muted hover:text-fg', focusRing)}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      {children ? <div className="p-4">{children}</div> : null}
      {footer ? <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div> : null}
    </dialog>
  )
}
