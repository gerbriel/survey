'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { cx, focusRing } from '@/components/ui'
import type { ContactNote } from '@/lib/crm/data/contacts'
import { memberName, type ActionResult, type MemberLite } from './types'

function stamp(iso: string) {
  return iso.slice(0, 16).replace('T', ' ') + ' UTC'
}

/** Markdown-lite: plain text with line breaks kept; no HTML is ever rendered. */
export function NotesPanel({
  notes,
  members,
  userId,
  canEdit,
  isAdmin,
  add,
  edit,
  remove,
}: {
  notes: ContactNote[]
  members: MemberLite[]
  userId: string
  canEdit: boolean
  isAdmin: boolean
  add: (body: string) => Promise<ActionResult<ContactNote>>
  edit: (noteId: string, body: string) => Promise<ActionResult>
  remove: (noteId: string) => Promise<ActionResult>
}) {
  const [list, setList] = useState(notes)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const area = cx('w-full rounded-md border border-border bg-surface p-2 text-sm', focusRing)

  return (
    <section aria-label="Notes" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Notes</h2>
      {canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const text = body.trim()
            if (!text) return
            start(async () => {
              const r = await add(text)
              if (!r.ok) return setError(r.message)
              setError(null)
              setBody('')
              setList((l) => [r.data, ...l])
            })
          }}
        >
          <label htmlFor="new-note" className="sr-only">
            New note
          </label>
          <textarea id="new-note" className={area} rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note" />
          <Button type="submit" size="sm" className="self-end" loading={pending} disabled={!body.trim()}>
            Add note
          </Button>
        </form>
      ) : null}
      <ul className="flex flex-col gap-3">
        {list.length === 0 ? <li className="text-sm text-muted">No notes yet.</li> : null}
        {list.map((n) => (
          <li key={n.id} className="rounded-md border border-border p-2">
            <p className="text-xs text-muted">
              {memberName(members, n.author)} at {stamp(n.created_at)}
              {n.updated_at !== n.created_at ? ', edited' : ''}
            </p>
            {editing === n.id ? (
              <form
                className="mt-1 flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  start(async () => {
                    const r = await edit(n.id, editBody.trim())
                    if (!r.ok) return setError(r.message)
                    setList((l) => l.map((x) => (x.id === n.id ? { ...x, body: editBody.trim(), updated_at: new Date().toISOString() } : x)))
                    setEditing(null)
                  })
                }}
              >
                <label htmlFor={`edit-${n.id}`} className="sr-only">
                  Edit note
                </label>
                <textarea id={`edit-${n.id}`} className={area} rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" loading={pending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
            )}
            <div className="mt-1 flex gap-3 text-xs">
              {canEdit && n.author === userId && editing !== n.id ? (
                <button
                  type="button"
                  className="text-accent"
                  onClick={() => {
                    setEditBody(n.body)
                    setEditing(n.id)
                  }}
                >
                  Edit
                </button>
              ) : null}
              {canEdit && (n.author === userId || isAdmin) ? (
                <button
                  type="button"
                  className="text-danger"
                  onClick={() =>
                    start(async () => {
                      const r = await remove(n.id)
                      if (!r.ok) return setError(r.message)
                      setList((l) => l.filter((x) => x.id !== n.id))
                    })
                  }
                >
                  Delete
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
