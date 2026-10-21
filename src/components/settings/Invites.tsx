'use client'

import { useActionState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { CopyButton } from '@/components/dashboard/CopyButton'
import { FormStatus, SubmitButton, fieldError } from '@/components/dashboard/form'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { roleLabel } from '@/components/dashboard/RoleBadge'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import type { InviteStatus } from '@/lib/admin/lifecycle'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

/** Create a workspace invite link (doc 05 section 3.2). The link is shown with a Copy button. */
export function InviteCreateForm({ action, roles }: { action: Action; roles: Array<'admin' | 'editor' | 'viewer'> }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form action={run} className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Role"
          name="role"
          defaultValue={roles.includes('editor') ? 'editor' : roles[0]}
          options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
          error={fieldError(state, 'role')}
        />
        <Select
          label="Expires after"
          name="expiresInDays"
          defaultValue="7"
          options={[
            { value: '1', label: '1 day' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
          ]}
          error={fieldError(state, 'expiresInDays')}
        />
        <Input
          label="Max uses"
          name="maxUses"
          type="number"
          min={1}
          max={50}
          defaultValue={1}
          required
          error={fieldError(state, 'maxUses')}
        />
        <Input label="Label (optional)" name="label" maxLength={80} placeholder="Fall interns" error={fieldError(state, 'label')} />
        <div className="sm:col-span-2">
          <SubmitButton>Create invite link</SubmitButton>
        </div>
      </form>
      <FormStatus state={state} />
      {state.status === 'success' && state.data?.url ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="text-sm font-medium" htmlFor="new-invite-url">
            New invite link
          </label>
          <input id="new-invite-url" readOnly value={state.data.url} className="w-full rounded border border-border bg-surface-muted px-2 py-1 font-mono text-xs" />
          <div>
            <CopyButton value={state.data.url} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export type InviteView = {
  id: string
  label: string | null
  role: 'admin' | 'editor' | 'viewer' | 'owner'
  createdBy: string
  expires: string
  uses: string
  status: InviteStatus
  url: string
}

const STATUS_LABEL: Record<InviteStatus, string> = { open: 'Open', used: 'Used up', expired: 'Expired', revoked: 'Revoked' }
const STATUS_TONE = { open: 'success', used: 'neutral', expired: 'neutral', revoked: 'danger' } as const

export function InvitesTable({ invites, revoke, readOnly }: { invites: InviteView[]; revoke: Action; readOnly: boolean }) {
  return (
    <Table caption="Invite links">
      <THead>
        <Tr>
          <Th>Label</Th>
          <Th>Role</Th>
          <Th>Created by</Th>
          <Th>Expires</Th>
          <Th>Uses</Th>
          <Th>Status</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </Tr>
      </THead>
      <TBody>
        {invites.map((i) => (
          <Tr key={i.id}>
            <Td>{i.label ?? <span className="text-muted">No label</span>}</Td>
            <Td>{roleLabel(i.role)}</Td>
            <Td>{i.createdBy}</Td>
            <Td className="whitespace-nowrap">{i.expires}</Td>
            <Td>{i.uses}</Td>
            <Td>
              <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
            </Td>
            <Td>
              {i.status === 'open' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton value={i.url} />
                  {readOnly ? null : (
                    <InlineAction
                      action={revoke}
                      fields={{ inviteId: i.id }}
                      label="Revoke"
                      variant="danger"
                      confirm="The link stops working at once. People who already joined keep their access."
                    />
                  )}
                </div>
              ) : null}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}
