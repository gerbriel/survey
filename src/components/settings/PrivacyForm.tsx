'use client'

import { useActionState, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Checkbox, FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type PrivacyValues = {
  storeIp: boolean
  retentionDays: number | null
  defaultCountry: string
  privacyNoticeUrl: string
  consentDefaultText: string
  pixelConsentMode: 'banner' | 'notice' | 'in_form'
  noticeAcknowledged: boolean
  noticeAckLine: string | null
}

const MODES = [
  { value: 'banner', label: 'Banner: pixels load only after the respondent accepts (default)' },
  { value: 'notice', label: 'Notice: informational banner, pixels load at once' },
  { value: 'in_form', label: 'In form: pixels load after a consent question is checked' },
]

/** Workspace privacy settings (doc 05 section 5.5, R7). Mechanics are doc 04. */
export function PrivacyForm({ action, values, canEdit }: { action: Action; values: PrivacyValues; canEdit: boolean }) {
  const [state, run] = useActionState(action, IDLE)
  const [mode, setMode] = useState(values.pixelConsentMode)
  const [retention, setRetention] = useState<'forever' | 'days'>(values.retentionDays === null ? 'forever' : 'days')
  const needsAck = mode === 'notice' && !(values.pixelConsentMode === 'notice' && values.noticeAcknowledged)

  return (
    <form action={run} className="flex max-w-xl flex-col gap-5">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5">
        <legend className="sr-only">Privacy settings</legend>
        <Checkbox
          label="Store respondent IP addresses"
          name="storeIp"
          defaultChecked={values.storeIp}
          hint="Off by default. Rate limiting never needs the raw address."
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Response retention</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="retentionMode" value="forever" checked={retention === 'forever'} onChange={() => setRetention('forever')} />
            Keep responses until someone deletes them
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="retentionMode" value="days" checked={retention === 'days'} onChange={() => setRetention('days')} />
            Delete responses automatically after a number of days
          </label>
          {retention === 'days' ? (
            <Input
              label="Days to keep responses"
              name="retentionDays"
              type="number"
              min={30}
              max={3650}
              defaultValue={values.retentionDays ?? 365}
              hint="30 to 3650 days. Files are deleted with their responses."
              error={fieldError(state, 'retentionDays')}
            />
          ) : null}
        </fieldset>
        <Input
          label="Default country"
          name="defaultCountry"
          defaultValue={values.defaultCountry}
          maxLength={2}
          required
          hint="Two letter ISO code, used to read phone numbers. For example US."
          error={fieldError(state, 'defaultCountry')}
        />
        <Input
          label="Workspace privacy notice URL (optional)"
          name="privacyNoticeUrl"
          type="url"
          defaultValue={values.privacyNoticeUrl}
          placeholder="https://"
          hint="Shown beside the organization notice in every public survey footer. https only."
          error={fieldError(state, 'privacyNoticeUrl')}
        />
        <TextArea
          label="Default consent text (optional)"
          name="consentDefaultText"
          defaultValue={values.consentDefaultText}
          maxLength={2000}
          rows={3}
          hint="Prefilled into new consent questions."
          error={fieldError(state, 'consentDefaultText')}
        />
        <Select
          label="Tracking pixel consent"
          name="pixelConsentMode"
          value={mode}
          onChange={(e) => setMode(e.target.value as PrivacyValues['pixelConsentMode'])}
          options={MODES}
          error={fieldError(state, 'pixelConsentMode')}
        />
        {needsAck ? (
          <Checkbox
            label="We are responsible for getting consent for these tools where the law requires it."
            name="acknowledgeNotice"
            required
            hint={fieldError(state, 'acknowledgeNotice') ?? 'Stored with your name and the time.'}
          />
        ) : null}
        {mode === 'notice' && values.noticeAckLine && !needsAck ? <p className="text-xs text-muted">{values.noticeAckLine}</p> : null}
      </fieldset>
      <FormStatus state={state} />
      {canEdit ? (
        <div>
          <SubmitButton>Save privacy settings</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">Only owners and admins can change privacy settings.</p>
      )}
    </form>
  )
}
