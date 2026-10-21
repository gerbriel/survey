'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge, Button, Input, Select } from '@/components/ui'
import type { ContactPatch } from '@/lib/db/contacts'
import { LEAD_STATUSES } from '@/lib/crm/import'
import { displayName, STATUS_LABELS, type ActionResult, type Contact, type MemberLite } from './types'

type CoreKey = 'email' | 'phone' | 'first_name' | 'last_name' | 'company'
const CORE: { key: CoreKey; label: string; type?: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'company', label: 'Company' },
]

/**
 * Header with inline edit of core fields, lead status, owner and follow-up.
 * Survey answers only fill blank fields (SQL); an editor here may overwrite.
 */
export function ContactHeader({
  contact,
  members,
  canEdit,
  unverified,
  update,
}: {
  contact: Contact
  members: MemberLite[]
  canEdit: boolean
  unverified: boolean
  update: (patch: ContactPatch) => Promise<ActionResult<Contact>>
}) {
  const [c, setC] = useState(contact)
  const [editing, setEditing] = useState<CoreKey | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  function save(patch: ContactPatch, after?: () => void) {
    start(async () => {
      setError(null)
      const r = await update(patch)
      if (!r.ok) {
        setError(r.message)
        return
      }
      setC(r.data)
      after?.()
      router.refresh()
    })
  }

  return (
    <section aria-label="Contact details" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{displayName(c)}</h1>
        <Badge>{STATUS_LABELS[c.lead_status]}</Badge>
        {unverified ? <Badge tone="warning">Unverified</Badge> : null}
        {c.source ? <Badge>Source: {c.source.startsWith('survey:') ? 'survey' : c.source}</Badge> : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {CORE.map((f) => (
          <div key={f.key} className="flex flex-col">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="flex items-center gap-2 text-sm">
              {editing === f.key ? (
                <form
                  className="flex w-full items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    save({ [f.key]: draft.trim() === '' ? null : draft } as ContactPatch, () => setEditing(null))
                  }}
                >
                  <Input label={f.label} type={f.type ?? 'text'} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
                  <Button type="submit" size="sm" loading={pending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span>{c[f.key] || <span className="text-muted">Not set</span>}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="text-xs text-accent"
                      aria-label={`Edit ${f.label}`}
                      onClick={() => {
                        setDraft(c[f.key] ?? '')
                        setEditing(f.key)
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select
          label="Lead status"
          value={c.lead_status}
          disabled={!canEdit || pending}
          onChange={(e) => save({ lead_status: e.target.value as Contact['lead_status'] })}
          options={LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        />
        <Select
          label="Owner"
          value={c.owner_id ?? ''}
          disabled={!canEdit || pending}
          onChange={(e) => save({ owner_id: e.target.value || null })}
          options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: m.display_name }))]}
        />
        <Input
          label="Follow-up date"
          type="date"
          defaultValue={c.follow_up_at ?? ''}
          disabled={!canEdit || pending}
          onBlur={(e) => {
            const v = e.target.value || null
            if (v !== c.follow_up_at) save({ follow_up_at: v })
          }}
        />
        <Input
          label="Follow-up note"
          defaultValue={c.follow_up_note ?? ''}
          maxLength={2000}
          disabled={!canEdit || pending}
          onBlur={(e) => {
            const v = e.target.value.trim() || null
            if (v !== c.follow_up_note) save({ follow_up_note: v })
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
