'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Badge, Button, Dialog } from '@/components/ui'
import { conflictRows, defaultChoices, mergedStatus } from './merge'
import { customText, displayName, memberName, STATUS_LABELS, type ActionResult, type Contact, type FieldDef, type MemberLite } from './types'

const LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  first_name: 'First name',
  last_name: 'Last name',
  company: 'Company',
  owner_id: 'Owner',
  follow_up_at: 'Follow-up date',
  follow_up_note: 'Follow-up note',
  source: 'Source',
}

/** Pick survivor, resolve conflicts field by field, confirm (no undo), merge. */
export function MergeFlow({
  slug,
  contacts,
  defs,
  members,
  counts,
  initialSurvivor,
  merge,
}: {
  slug: string
  contacts: Contact[]
  defs: FieldDef[]
  members: MemberLite[]
  counts: { notes: Record<string, number>; tokens: Record<string, number> }
  initialSurvivor: string
  merge: (survivorId: string, mergedIds: string[], choices: Record<string, string>) => Promise<ActionResult>
}) {
  const [survivor, setSurvivor] = useState(initialSurvivor)
  const rows = useMemo(() => conflictRows(contacts, defs, LABELS), [contacts, defs])
  const [choices, setChoices] = useState(() => defaultChoices(rows, initialSurvivor))
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const losers = contacts.filter((c) => c.id !== survivor)
  const survivorContact = contacts.find((c) => c.id === survivor)!
  const moved = {
    responses: losers.reduce((n, c) => n + c.response_count, 0),
    notes: losers.reduce((n, c) => n + (counts.notes[c.id] ?? 0), 0),
    links: losers.reduce((n, c) => n + (counts.tokens[c.id] ?? 0), 0),
  }
  const show = (field: string, v: unknown) => (field === 'owner_id' ? memberName(members, v as string) : customText(v))
  const tags = [...new Set(contacts.flatMap((c) => c.tags))].sort()

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-semibold">1. Keep which contact?</legend>
        {contacts.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="survivor"
              checked={survivor === c.id}
              onChange={() => {
                setSurvivor(c.id)
                setChoices(defaultChoices(rows, c.id))
              }}
            />
            <span className="font-medium">{displayName(c)}</span>
            <span className="text-muted">
              {c.email ?? 'No email'}, {c.response_count} responses, created {c.created_at.slice(0, 10)}
            </span>
          </label>
        ))}
      </fieldset>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">2. Resolve differences</h2>
        {rows.length === 0 ? <p className="text-sm text-muted">No conflicting fields. Blank fields are filled from the others.</p> : null}
        {rows.map((r) => (
          <fieldset key={r.field} className="flex flex-wrap items-center gap-4 border-b border-border pb-2">
            <legend className="w-40 text-sm font-medium">{r.label}</legend>
            {r.values.map((v) => (
              <label key={v.contactId} className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name={`choice-${r.field}`}
                  checked={choices[r.field] === v.contactId}
                  onChange={() => setChoices((ch) => ({ ...ch, [r.field]: v.contactId }))}
                />
                {show(r.field, v.value)}
              </label>
            ))}
          </fieldset>
        ))}
        <p className="text-sm">
          Lead status becomes <Badge>{STATUS_LABELS[mergedStatus(contacts)]}</Badge>. Tags are combined:{' '}
          {tags.length ? tags.join(', ') : 'none'}. All notes are kept.
        </p>
      </section>

      <div>
        <Button onClick={() => setConfirm(true)}>Review and merge</Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Merge contacts?"
        description="Merging cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await merge(
                    survivor,
                    losers.map((c) => c.id),
                    choices,
                  )
                  if (!r.ok) return setError(r.message)
                  router.push(`/w/${slug}/contacts/${survivor}`)
                })
              }
            >
              Merge, no undo
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {moved.responses} responses, {moved.notes} notes, {moved.links} links move to {displayName(survivorContact)}. The other{' '}
          {losers.length === 1 ? 'contact is' : `${losers.length} contacts are`} kept only as aliases so old links and emails still
          resolve. There is no undo.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
