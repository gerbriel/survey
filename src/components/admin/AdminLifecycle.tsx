'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormStatus, SubmitButton, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Simple = (prev: ActionState) => Promise<ActionState>
type WithForm = (prev: ActionState, form: FormData) => Promise<ActionState>

function SimpleButton({ action, label, variant = 'secondary' }: { action: Simple; label: string; variant?: 'secondary' | 'danger' }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex flex-col gap-2">
      <div>
        <SubmitButton variant={variant}>{label}</SubmitButton>
      </div>
      <FormStatus state={state} />
    </form>
  )
}

/**
 * Archive, delete and restore with the timing rules spelled out (doc 05
 * sections 1.3, 1.4). The server computes the dates; SQL enforces them.
 */
export function AdminLifecycle({
  slug,
  state,
  timing,
  canDelete,
  canRestore,
  archive,
  unarchive,
  requestDeletion,
  restore,
}: {
  slug: string
  state: 'active' | 'archived' | 'deletion_requested'
  timing: string
  canDelete: boolean
  canRestore: boolean
  archive: Simple
  unarchive: Simple
  requestDeletion: WithForm
  restore: Simple
}) {
  const [delState, del] = useActionState(requestDeletion, IDLE)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{timing}</p>
      {state === 'active' ? <SimpleButton action={archive} label="Archive workspace" variant="danger" /> : null}
      {state === 'archived' ? (
        <>
          <SimpleButton action={unarchive} label="Unarchive workspace" />
          {canDelete ? (
            <form action={del} className="flex max-w-md flex-col gap-3 border-t border-border pt-4">
              <Input label={`Type ${slug} to request deletion`} name="confirmSlug" autoComplete="off" required error={fieldError(delState, 'confirmSlug')} />
              <div>
                <SubmitButton variant="danger">Request deletion</SubmitButton>
              </div>
              <FormStatus state={delState} />
            </form>
          ) : null}
        </>
      ) : null}
      {state === 'deletion_requested' && canRestore ? <SimpleButton action={restore} label="Restore workspace" /> : null}
    </div>
  )
}

/** Force transfer when an owner leaves the organization (doc 05 section 2.2). Logged in both audit logs. */
export function ForceTransferForm({ action, members }: { action: WithForm; members: Array<{ value: string; label: string }> }) {
  const [state, run] = useActionState(action, IDLE)
  if (members.length === 0) return <p className="text-sm text-muted">No other active members to transfer to.</p>
  return (
    <form action={run} className="flex max-w-md flex-col gap-3">
      <Select label="New owner" name="userId" required placeholder="Pick a member" options={members} error={fieldError(state, 'userId')} />
      <FormStatus state={state} />
      <div>
        <SubmitButton variant="danger">Force transfer ownership</SubmitButton>
      </div>
    </form>
  )
}
