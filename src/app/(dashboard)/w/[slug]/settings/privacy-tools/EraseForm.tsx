'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import type { EraseState } from './actions'

const INITIAL: EraseState = { status: 'idle', message: '' }

/** Erase with an explicit mode choice and a typed confirmation (doc 04 section 7.2). */
export function EraseForm({ email, action }: { email: string | null; action: (prev: EraseState, formData: FormData) => Promise<EraseState> }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<EraseState, FormData>(action, INITIAL)
  const phrase = email ?? 'DELETE'
  if (state.status === 'done') {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    )
  }
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Erase respondent
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Erase this respondent" description="This cannot be undone.">
        <form action={formAction} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-fg">What to do</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value="anonymize" defaultChecked />
              <span>
                <strong>Anonymize.</strong> Keep choice, rating and number answers for aggregates. Remove identity, open text, files, notes, tokens and the contact&apos;s personal fields.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value="hard" />
              <span>
                <strong>Hard delete.</strong> Delete every response, answer, event, file, note, token and the contact itself.
              </span>
            </label>
          </fieldset>
          <Input label={`Type ${phrase} to confirm`} name="confirm" autoComplete="off" required />
          {state.status === 'error' ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Erase
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
