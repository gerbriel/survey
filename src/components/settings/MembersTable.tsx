'use client'

import { useActionState } from 'react'
import type { WorkspaceRole } from '@/types/db-helpers'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { FormStatus, SubmitButton } from '@/components/dashboard/form'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { RoleBadge, roleLabel } from '@/components/dashboard/RoleBadge'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { assignableRoles, canRemove } from './member-rules'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type MemberView = {
  userId: string
  name: string
  avatarUrl: string | null
  role: WorkspaceRole
  joined: string
  inviteLabel: string | null
}

function RoleForm({ action, member, roles }: { action: Action; member: MemberView; roles: WorkspaceRole[] }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={member.userId} />
      <div className="w-32">
        <Select
          label={<span className="sr-only">Role for {member.name}</span>}
          name="role"
          defaultValue={member.role}
          options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
        />
      </div>
      <SubmitButton size="sm" variant="secondary">
        Change
      </SubmitButton>
      <FormStatus state={state} />
    </form>
  )
}

/** Member list for every member; controls follow the role rules (doc 05 section 2). */
export function MembersTable({
  members,
  currentUserId,
  actorRole,
  readOnly,
  changeRole,
  remove,
}: {
  members: MemberView[]
  currentUserId: string
  actorRole: WorkspaceRole
  readOnly: boolean
  changeRole: Action
  remove: Action
}) {
  return (
    <Table caption="Workspace members">
      <THead>
        <Tr>
          <Th>Member</Th>
          <Th>Role</Th>
          <Th>Joined</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </Tr>
      </THead>
      <TBody>
        {members.map((m) => {
          const isSelf = m.userId === currentUserId
          const roles = readOnly || isSelf ? [] : assignableRoles(actorRole, m.role)
          const removable = !readOnly && canRemove(actorRole, m.role, isSelf)
          return (
            <Tr key={m.userId}>
              <Td>
                <div className="flex items-center gap-2">
                  {m.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- OAuth avatar URL
                    <img src={m.avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-xs">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <div className="font-medium">
                      {m.name}
                      {isSelf ? <span className="text-muted"> (you)</span> : null}
                    </div>
                    {m.inviteLabel ? <div className="text-xs text-muted">Invite: {m.inviteLabel}</div> : null}
                  </div>
                </div>
              </Td>
              <Td>{roles.length ? <RoleForm action={changeRole} member={m} roles={roles} /> : <RoleBadge role={m.role} />}</Td>
              <Td className="whitespace-nowrap">{m.joined}</Td>
              <Td>
                {removable ? (
                  <InlineAction
                    action={remove}
                    fields={{ userId: m.userId }}
                    label={isSelf ? 'Leave workspace' : 'Remove'}
                    variant="danger"
                    confirm={
                      isSelf
                        ? 'You will lose access to this workspace. Everything you created stays.'
                        : `Remove ${m.name}? Everything they created stays.`
                    }
                  />
                ) : null}
              </Td>
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}

/** Owner only: pick any other member as the new owner; the old owner becomes admin. */
export function TransferOwnershipForm({ action, candidates }: { action: Action; candidates: MemberView[] }) {
  const [state, run] = useActionState(action, IDLE)
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Invite another member before you can transfer ownership.</p>
  }
  return (
    <form action={run} className="flex max-w-md flex-col gap-3">
      <Select
        label="New owner"
        name="userId"
        required
        placeholder="Pick a member"
        options={candidates.map((c) => ({ value: c.userId, label: `${c.name} (${roleLabel(c.role)})` }))}
        hint="You become an admin. This cannot be undone without the new owner."
      />
      <FormStatus state={state} />
      <div>
        <SubmitButton variant="danger">Transfer ownership</SubmitButton>
      </div>
    </form>
  )
}
