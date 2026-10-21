'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/Input'
import { FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export function CheckAgainForm({ action }: { action: (prev: ActionState) => Promise<ActionState> }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex flex-col gap-2">
      <SubmitButton>Check again</SubmitButton>
      <FormStatus state={state} />
    </form>
  )
}

export function AccessRequestForm({ action, defaultName }: { action: Action; defaultName: string }) {
  const [state, run] = useActionState(action, IDLE)
  if (state.status === 'success') return <FormStatus state={state} />
  return (
    <form action={run} className="mt-4 flex flex-col gap-4">
      <Input label="Your name" name="name" required maxLength={120} defaultValue={defaultName} error={fieldError(state, 'name')} />
      <Input label="Department" name="department" maxLength={120} error={fieldError(state, 'department')} />
      <TextArea label="Why do you need access?" name="reason" maxLength={2000} rows={3} error={fieldError(state, 'reason')} />
      <FormStatus state={state} />
      <div>
        <SubmitButton>Send request</SubmitButton>
      </div>
    </form>
  )
}

export function WorkspaceRequestForm({ action }: { action: Action }) {
  const [state, run] = useActionState(action, IDLE)
  if (state.status === 'success') return <FormStatus state={state} />
  return (
    <form action={run} className="mt-4 flex flex-col gap-4">
      <Input label="Department or team name" name="departmentName" required maxLength={80} error={fieldError(state, 'departmentName')} />
      <TextArea label="What will you use it for?" name="purpose" maxLength={2000} rows={3} error={fieldError(state, 'purpose')} />
      <FormStatus state={state} />
      <div>
        <SubmitButton>Request a workspace</SubmitButton>
      </div>
    </form>
  )
}
