'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { CopyButton } from '@/components/dashboard/CopyButton'
import { FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { LIMIT_FIELDS } from '@/lib/admin/limits-form'
import { RAW_SCRIPT_EXPOSURE } from '@/lib/admin/pixels'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

/** Shows a one-time secret (invite link or reset link) with a copy button. */
function OneTimeValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <input readOnly aria-label={label} value={value} className="w-full rounded border border-border bg-surface-muted px-2 py-1 font-mono text-xs" />
      <div>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

/** Issue a platform invite (doc 05 section 3.1): email optional, note, expiry. */
export function PlatformInviteForm({ action }: { action: Action }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form action={run} className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Email (optional)"
          name="email"
          type="email"
          hint="With an email, signing in with that address activates the account. Without one, only the link works."
          error={fieldError(state, 'email')}
        />
        <Input label="Note (optional)" name="note" maxLength={200} placeholder="Finance team lead" error={fieldError(state, 'note')} />
        <Select
          label="Expires after"
          name="expiresInDays"
          defaultValue="30"
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
          error={fieldError(state, 'expiresInDays')}
        />
        <div className="flex items-end">
          <SubmitButton>Create invite</SubmitButton>
        </div>
      </form>
      <FormStatus state={state} />
      {state.status === 'success' && state.data?.url ? <OneTimeValue label="Invite link" value={state.data.url} /> : null}
    </div>
  )
}

export type OwnerOption = { value: string; label: string }

/** Create a workspace and pick its first owner (doc 05 section 1.1). */
export function CreateWorkspaceForm({
  action,
  owners,
  defaults,
}: {
  action: Action
  owners: OwnerOption[]
  defaults?: { name?: string; requestId?: string; ownerId?: string }
}) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {defaults?.requestId ? <input type="hidden" name="requestId" value={defaults.requestId} /> : null}
      <Input label="Name" name="name" required maxLength={80} defaultValue={defaults?.name ?? ''} error={fieldError(state, 'name')} />
      <Input
        label="Address"
        name="slug"
        required
        maxLength={40}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        hint="3 to 40 lowercase letters, numbers and hyphens. Dashboard links use /w/address."
        error={fieldError(state, 'slug')}
      />
      <div className="sm:col-span-2">
        <Select
          label="First owner"
          name="ownerId"
          required
          placeholder="Pick a person"
          defaultValue={defaults?.ownerId ?? ''}
          options={owners}
          hint="Anyone who has signed in, active or pending. A pending owner is activated. Not listed? Issue a platform invite first."
          error={fieldError(state, 'ownerId')}
        />
      </div>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div>
          <SubmitButton>Create workspace</SubmitButton>
        </div>
      </div>
    </form>
  )
}

/** workspace_limits overrides with the raw script kill switch and a required note (doc 05 section 5.6). */
export function LimitsEditor({ action, defaults }: { action: Action; defaults: Record<string, string> }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {LIMIT_FIELDS.map((f) => (
        <Input
          key={f.name}
          label={f.label}
          name={f.name}
          type="number"
          min={0}
          step="any"
          defaultValue={defaults[f.name] ?? ''}
          placeholder="Default"
          error={fieldError(state, f.name)}
        />
      ))}
      <Select
        label="Script pixels (GTM and custom scripts)"
        name="rawScript"
        defaultValue={defaults.rawScript ?? 'default'}
        options={[
          // S3 (R16): the default is off for every workspace.
          { value: 'default', label: 'Default (turned off)' },
          { value: 'allowed', label: 'Allowed' },
          { value: 'blocked', label: 'Turned off (kill switch)' },
        ]}
        hint="Turned off stops existing script pixels from loading and blocks enabling new ones."
        error={fieldError(state, 'rawScript')}
      />
      <p role="note" className="rounded-md border border-warning p-3 text-sm sm:col-span-2">
        {RAW_SCRIPT_EXPOSURE}
      </p>
      <div className="sm:col-span-2">
        <TextArea
          label="Note"
          name="note"
          required
          maxLength={2000}
          rows={2}
          defaultValue={defaults.note ?? ''}
          hint="Required. Why this workspace differs from the defaults."
          error={fieldError(state, 'note')}
        />
      </div>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div>
          <SubmitButton>Save limits</SubmitButton>
        </div>
      </div>
    </form>
  )
}

/** Mint a password reset link and show it once (doc 05 section 4.3). */
export function ResetLinkForm({ action, userId }: { action: Action; userId: string }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <SubmitButton size="sm" variant="secondary">
          Generate reset link
        </SubmitButton>
      </div>
      <FormStatus state={state} />
      {state.status === 'success' && state.data?.link ? <OneTimeValue label="Password reset link" value={state.data.link} /> : null}
    </form>
  )
}
