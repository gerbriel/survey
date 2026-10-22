'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { updateSettingsAction } from '@/lib/builder/actions'
import type { SurveySettingsPatch } from '@/lib/db/surveys'
import { publicAssetUrl } from '@/lib/builder/share'
import { Check, NumberField, Section, TextArea } from './fields'
import { ImageUpload } from './ImageUpload'

export interface SettingsValues {
  state: 'draft' | 'open' | 'closed' | 'scheduled'
  opens_at: string | null
  closes_at: string | null
  closed_message: string | null
  response_cap: number | null
  excluded_pixel_ids: string[]
  og_title: string | null
  og_description: string | null
  og_image_path: string | null
  allow_indexing: boolean
}

function toLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function fromLocal(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const STATES: { value: SettingsValues['state']; label: string; hint: string }[] = [
  { value: 'draft', label: 'Not public', hint: 'The link shows a not found page.' },
  { value: 'open', label: 'Open', hint: 'Accepts responses now (until the close time, if set).' },
  { value: 'scheduled', label: 'Scheduled', hint: 'Opens at the open time, closes at the close time if set.' },
  { value: 'closed', label: 'Closed', hint: 'Shows the closed message.' },
]

/**
 * Survey state and delivery settings (doc 02 sections 3, 7, 11). Writes the
 * surveys row that resolve_public_survey reads: state, opens_at, closes_at,
 * closed_message, response_cap, excluded_pixel_ids, og_*, allow_indexing.
 */
export function SettingsForm({
  surveyId,
  workspaceId,
  initial,
  published,
  pixels,
  canEdit,
  editHref,
  identityText,
  trustHidden,
  stateText,
}: {
  surveyId: string
  workspaceId: string
  initial: SettingsValues
  published: boolean
  pixels: { id: string; label: string; type: string; enabled: boolean }[]
  canEdit: boolean
  editHref: string
  identityText: string
  trustHidden: boolean
  stateText: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [v, setV] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<SettingsValues>) => setV((x) => ({ ...x, ...patch }))
  const disabled = !canEdit
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ogUrl = publicAssetUrl(supabaseUrl, v.og_image_path)

  function problem(): string | null {
    if ((v.state === 'open' || v.state === 'scheduled') && !published) return 'Publish the survey before opening or scheduling it.'
    if (v.state === 'scheduled' && !v.opens_at) return 'A scheduled survey needs an open time.'
    if (v.opens_at && v.closes_at && Date.parse(v.closes_at) <= Date.parse(v.opens_at)) return 'The close time must be after the open time.'
    return null
  }

  async function submit() {
    const p = problem()
    if (p) return setError(p)
    setError(null)
    setSaving(true)
    const patch: SurveySettingsPatch = {
      state: v.state,
      opens_at: v.opens_at,
      closes_at: v.closes_at,
      closed_message: v.closed_message?.trim() ? v.closed_message.trim() : null,
      response_cap: v.response_cap,
      excluded_pixel_ids: v.excluded_pixel_ids,
      og_title: v.og_title?.trim() || null,
      og_description: v.og_description?.trim() || null,
      og_image_path: v.og_image_path,
      allow_indexing: false, // Owner decision 2026-10-22: surveys are never indexable; the option was removed from the UI.
    }
    const r = await updateSettingsAction(surveyId, patch)
    setSaving(false)
    if (!r.ok) return setError(r.message)
    toast('Settings saved.', 'success')
    router.refresh()
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Section title="State">
        <p className="text-sm">
          Right now: <strong>{stateText}</strong>
        </p>
        {!published ? <p className="text-sm text-warning">This survey has never been published. Publish it from the Edit tab first.</p> : null}
        <div role="radiogroup" aria-label="Survey state" className="flex flex-col gap-2">
          {STATES.map((s) => (
            <label key={s.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="state" value={s.value} checked={v.state === s.value} disabled={disabled} onChange={() => set({ state: s.value })} className="mt-1" />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Input label="Open time" type="datetime-local" required={v.state === 'scheduled'} value={toLocal(v.opens_at)} disabled={disabled} onChange={(e) => set({ opens_at: fromLocal(e.target.value) })} />
        <Input label="Close time" hint="Optional. Respondents who started before it get 15 extra minutes." type="datetime-local" value={toLocal(v.closes_at)} disabled={disabled} onChange={(e) => set({ closes_at: fromLocal(e.target.value) })} />
        <NumberField
          label="Response limit"
          hint="Optional. When complete responses reach it, the survey shows the closed message. Raising it reopens the survey."
          min={1}
          value={v.response_cap ?? undefined}
          disabled={disabled}
          onChange={(n) => set({ response_cap: n && n > 0 ? Math.floor(n) : null })}
        />
        <TextArea
          label="Closed message"
          hint="Plain text, up to 1,000 characters. Empty uses the workspace default."
          maxLength={1000}
          value={v.closed_message ?? ''}
          disabled={disabled}
          onChange={(e) => set({ closed_message: e.target.value })}
        />
      </Section>

      <Section title="Tracking pixels">
        {pixels.length === 0 ? <p className="text-sm text-muted">The workspace has no tracking pixels.</p> : <p className="text-sm text-muted">Untick a pixel to keep it off this survey.</p>}
        {pixels.map((p) => (
          <Check
            key={p.id}
            label={`${p.label} (${p.type}${p.enabled ? '' : ', disabled for the workspace'})`}
            checked={!v.excluded_pixel_ids.includes(p.id)}
            disabled={disabled}
            onChange={(on) => set({ excluded_pixel_ids: on ? v.excluded_pixel_ids.filter((x) => x !== p.id) : [...v.excluded_pixel_ids, p.id] })}
          />
        ))}
      </Section>

      <Section title="Link preview">
        <Input label="Preview title" hint="Shown when the link is shared. Defaults to the survey title." maxLength={120} value={v.og_title ?? ''} disabled={disabled} onChange={(e) => set({ og_title: e.target.value })} />
        <TextArea label="Preview description" maxLength={300} value={v.og_description ?? ''} disabled={disabled} onChange={(e) => set({ og_description: e.target.value })} />
        {ogUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage URL preview
          <img src={ogUrl} alt="Link preview image" className="max-h-40 w-auto self-start rounded border border-border" />
        ) : null}
        <ImageUpload label={v.og_image_path ? 'Replace the preview image' : 'Upload a preview image'} workspaceId={workspaceId} surveyId={surveyId} name="og" disabled={disabled} onUploaded={(path) => set({ og_image_path: path })} />
        {v.og_image_path ? (
          <Button variant="ghost" size="sm" className="self-start" disabled={disabled} onClick={() => set({ og_image_path: null })}>
            Remove preview image
          </Button>
        ) : null}
      </Section>

      <Section title="Identity and endings">
        <p className="text-sm">{identityText}</p>
        <p className="text-sm">{trustHidden ? 'Email and contact values in the link may link a contact (unverified).' : 'Email and contact values in the link are not trusted.'}</p>
        <p className="text-sm text-muted">
          The identity question, link trust, thank-you screens and redirects are part of the survey and change with the next publish.{' '}
          <Link href={editHref} className="underline">
            Edit them in the builder
          </Link>
          .
        </p>
      </Section>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <Button type="submit" loading={saving} className="self-start">
          Save settings
        </Button>
      ) : null}
    </form>
  )
}
