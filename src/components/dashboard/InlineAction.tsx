'use client'

import { useActionState, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { FormStatus, SubmitButton } from './form'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

/**
 * One-button form with hidden fields, for row actions (revoke, remove,
 * dismiss). With `confirm`, the button opens a dialog and the dialog's
 * button submits. The result line sits beside the button.
 */
export function InlineAction({
  action,
  fields = {},
  label,
  variant = 'secondary',
  confirm,
  confirmLabel,
  children,
}: {
  action: Action
  fields?: Record<string, string>
  label: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** Dialog body; when set the action needs a second click. */
  confirm?: ReactNode
  confirmLabel?: string
  /** Extra form controls rendered inside the dialog (for example a select). */
  children?: ReactNode
}) {
  const [state, run] = useActionState(action, IDLE)
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const hidden = Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)

  if (!confirm) {
    return (
      <form action={run} className="inline-flex flex-wrap items-center gap-2">
        {hidden}
        {children}
        <SubmitButton size="sm" variant={variant}>
          {label}
        </SubmitButton>
        <FormStatus state={state} />
      </form>
    )
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormStatus state={state} />
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        <form
          ref={formRef}
          action={(fd) => {
            setOpen(false)
            run(fd)
          }}
          className="flex flex-col gap-4"
        >
          {hidden}
          <div className="text-sm">{confirm}</div>
          {children}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={variant === 'secondary' ? 'primary' : variant}>
              {confirmLabel ?? label}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
