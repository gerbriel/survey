'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/Input'
import { Checkbox, FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type GeneralValues = {
  name: string
  slug: string
  defaultTheme: string
  showPoweredBy: boolean
}

/**
 * Name, address, default theme and footer toggle (doc 05 section 5.1).
 * Decision: the default theme is a plain JSON textarea (doc 03 Theme shape,
 * blank means the built-in defaults); the full visual theme editor lives in
 * the builder (2B).
 */
export function GeneralForm({ action, values, canEdit }: { action: Action; values: GeneralValues; canEdit: boolean }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex max-w-xl flex-col gap-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <legend className="sr-only">General settings</legend>
        <Input label="Workspace name" name="name" defaultValue={values.name} maxLength={80} required error={fieldError(state, 'name')} />
        <Input
          label="Address"
          name="slug"
          defaultValue={values.slug}
          maxLength={40}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          hint="Used in dashboard links as /w/address. After a rename the old address redirects for 30 days. Public survey links never change."
          error={fieldError(state, 'slug')}
        />
        <TextArea
          label="Default theme (JSON)"
          name="defaultTheme"
          defaultValue={values.defaultTheme}
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          hint="Copied into new surveys. Leave blank for the built-in theme."
          error={fieldError(state, 'defaultTheme')}
        />
        <Checkbox
          label="Show Powered by Survey on public surveys"
          name="showPoweredBy"
          defaultChecked={values.showPoweredBy}
          hint="The privacy notice and report links always show."
        />
      </fieldset>
      <FormStatus state={state} />
      {canEdit ? (
        <div>
          <SubmitButton>Save changes</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">Only owners and admins can change these settings.</p>
      )}
    </form>
  )
}
