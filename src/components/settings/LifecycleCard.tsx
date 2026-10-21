'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { FormStatus, SubmitButton, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Simple = (prev: ActionState) => Promise<ActionState>
type WithForm = (prev: ActionState, form: FormData) => Promise<ActionState>

/**
 * Owner only: archive, unarchive, delete (doc 05 sections 1.3 and 1.4).
 * Delete is offered 7 days after archiving and needs the address typed.
 * Dates are computed on the server and passed in as text.
 */
export function LifecycleCard({
  slug,
  archived,
  deletionAvailable,
  deletionAvailableOn,
  archiveAction,
  unarchiveAction,
  deleteAction,
}: {
  slug: string
  archived: boolean
  deletionAvailable: boolean
  deletionAvailableOn: string | null
  archiveAction: Simple
  unarchiveAction: Simple
  deleteAction: WithForm
}) {
  const [archiveState, doArchive] = useActionState(archiveAction, IDLE)
  const [unarchiveState, doUnarchive] = useActionState(unarchiveAction, IDLE)
  const [deleteState, doDelete] = useActionState(deleteAction, IDLE)
  const [confirmArchive, setConfirmArchive] = useState(false)

  return (
    <section aria-labelledby="lifecycle" className="max-w-xl rounded-lg border border-danger p-4">
      <h2 id="lifecycle" className="text-base font-semibold">
        Archive and delete
      </h2>
      {!archived ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">
            Archiving makes everything read only and shows the closed message on every public survey. You can
            unarchive at any time. Deletion becomes available 7 days after archiving.
          </p>
          <div>
            <Button variant="secondary" onClick={() => setConfirmArchive(true)}>
              Archive workspace
            </Button>
          </div>
          <FormStatus state={archiveState} />
          <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive this workspace?">
            <form
              action={() => {
                setConfirmArchive(false)
                doArchive()
              }}
              className="flex flex-col gap-4"
            >
              <p className="text-sm">Members keep read access. All writes stop until you unarchive.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger">
                  Archive
                </Button>
              </div>
            </form>
          </Dialog>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          <form action={doUnarchive} className="flex flex-col gap-2">
            <p className="text-sm text-muted">This workspace is archived.</p>
            <div>
              <SubmitButton variant="secondary">Unarchive workspace</SubmitButton>
            </div>
            <FormStatus state={unarchiveState} />
          </form>
          {deletionAvailable ? (
            <form action={doDelete} className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm">
                Deleting hides the workspace for everyone at once. A platform admin can restore it for 30 days, then
                all surveys, responses, contacts and files are deleted for good.
              </p>
              <Input
                label={`Type ${slug} to confirm`}
                name="confirmSlug"
                autoComplete="off"
                required
                error={fieldError(deleteState, 'confirmSlug')}
              />
              <div>
                <SubmitButton variant="danger">Delete workspace</SubmitButton>
              </div>
              <FormStatus state={deleteState} />
            </form>
          ) : (
            <p className="text-sm text-muted">Deletion becomes available on {deletionAvailableOn}.</p>
          )}
        </div>
      )}
    </section>
  )
}
