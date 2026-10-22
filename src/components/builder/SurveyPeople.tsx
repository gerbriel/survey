'use client'

import { useActionState } from 'react'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { PersonChip, type Person } from '@/components/dashboard/Avatar'
import { FormStatus, SubmitButton } from '@/components/dashboard/form'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { PeopleMultiPicker, PersonPicker, type PickerPerson } from '@/components/dashboard/PersonPicker'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type AssignedPerson = Person & { userId: string }

function OwnerForm({ action, candidates }: { action: Action; candidates: PickerPerson[] }) {
  const [state, run] = useActionState(action, IDLE)
  if (candidates.length === 0) return <p className="text-sm text-muted">No other active members to hand this survey to.</p>
  return (
    <form action={run} className="flex max-w-md flex-col gap-3">
      <PersonPicker people={candidates} name="userId" label="New owner" placeholder="Pick a member" />
      <FormStatus state={state} />
      <div>
        <SubmitButton variant="secondary">Set owner</SubmitButton>
      </div>
    </form>
  )
}

function AddCollaboratorsForm({ action, candidates }: { action: Action; candidates: PickerPerson[] }) {
  const [state, run] = useActionState(action, IDLE)
  if (candidates.length === 0) return <p className="text-sm text-muted">Every active member is already on this survey.</p>
  return (
    <form action={run} className="flex max-w-md flex-col gap-3">
      <PeopleMultiPicker people={candidates} name="userId" legend="Add collaborators" />
      <FormStatus state={state} />
      <div>
        <SubmitButton variant="secondary">Add selected</SubmitButton>
      </div>
    </form>
  )
}

/**
 * People section of the survey Settings tab (R19): one owner, any number of
 * collaborators, chosen from active workspace members. Responsibility only;
 * access is still the workspace role. Controls show for editors and above;
 * that is UX only, the SQL functions refuse everyone else.
 */
export function SurveyPeople({
  owner,
  collaborators,
  members,
  canEdit,
  setOwner,
  addCollaborators,
  removeCollaborator,
}: {
  owner: AssignedPerson | null
  collaborators: AssignedPerson[]
  /** Active workspace members, detail = role label. */
  members: PickerPerson[]
  canEdit: boolean
  setOwner: Action
  addCollaborators: Action
  removeCollaborator: Action
}) {
  const assigned = new Set([owner?.userId, ...collaborators.map((c) => c.userId)])
  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 id="people-heading" className="text-lg font-semibold">
          People
        </h2>
        <p className="text-sm text-muted">
          Who is responsible for this survey. This does not change access: every member sees and edits by their
          workspace role.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Owner</h3>
        {owner ? <PersonChip person={owner} size="md" /> : <p className="text-sm text-muted">Unassigned.</p>}
        {canEdit ? <OwnerForm action={setOwner} candidates={members.filter((m) => m.id !== owner?.userId)} /> : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Collaborators ({collaborators.length})</h3>
        {collaborators.length === 0 ? (
          <p className="text-sm text-muted">No collaborators yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {collaborators.map((c) => (
              <li key={c.userId} className="flex flex-wrap items-center justify-between gap-2">
                <PersonChip person={c} size="md" />
                {canEdit ? (
                  <InlineAction action={removeCollaborator} fields={{ userId: c.userId }} label={`Remove ${c.name}`} variant="ghost" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? <AddCollaboratorsForm action={addCollaborators} candidates={members.filter((m) => !assigned.has(m.id))} /> : null}
      </div>
    </section>
  )
}
