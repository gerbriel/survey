'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Dialog, Input } from '@/components/ui'
import { COLUMN_LABELS, CORE_COLUMNS } from '@/lib/crm/filters'
import type { ContactView } from '@/lib/crm/data/contacts'
import { LinkButton } from './LinkButton'
import type { ActionResult, FieldDef } from './types'

export type ViewLink = { view: ContactView; href: string; mine: boolean }

/** Saved views, column chooser, save view, and new contact. */
export function ContactsToolbar({
  slug,
  views,
  activeViewId,
  columns,
  fieldDefs,
  currentQuery,
  canEdit,
  saveView,
  deleteView,
  createContact,
}: {
  slug: string
  views: ViewLink[]
  activeViewId: string | null
  columns: string[]
  fieldDefs: FieldDef[]
  /** Current URL query without `cols`, `sv` and `cursor`. */
  currentQuery: string
  canEdit: boolean
  saveView: (name: string, shared: boolean) => Promise<ActionResult<string>>
  deleteView: (id: string) => Promise<ActionResult>
  createContact: (v: { email: string; first_name: string; last_name: string; company: string; phone: string }) => Promise<ActionResult<string>>
}) {
  const router = useRouter()
  const [colsOpen, setColsOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [cols, setCols] = useState(columns)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ email: '', first_name: '', last_name: '', company: '', phone: '' })
  const [pending, start] = useTransition()
  const base = `/w/${slug}/contacts`
  const allCols = [...CORE_COLUMNS, ...fieldDefs.filter((d) => !d.archived).map((d) => `custom.${d.key}`)]
  const colLabel = (c: string) => (c.startsWith('custom.') ? (fieldDefs.find((d) => d.key === c.slice(7))?.label ?? c) : (COLUMN_LABELS[c] ?? c))

  function applyColumns() {
    const p = new URLSearchParams(currentQuery)
    p.set('cols', cols.join(','))
    if (activeViewId) p.set('sv', activeViewId)
    setColsOpen(false)
    router.push(`${base}?${p.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Saved views" className="flex flex-wrap items-center gap-2">
        {views.map(({ view, href, mine }) => (
          <span key={view.id} className="inline-flex items-center gap-1">
            <Link
              href={href}
              aria-current={view.id === activeViewId ? 'page' : undefined}
              className={
                view.id === activeViewId
                  ? 'rounded-full bg-accent px-3 py-1 text-sm text-accent-fg'
                  : 'rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-muted'
              }
            >
              {view.name}
              {view.shared && !view.builtin ? ' (shared)' : ''}
            </Link>
            {!view.builtin && (mine || canEdit) ? (
              <button
                type="button"
                className="text-xs text-muted hover:text-danger"
                aria-label={`Delete view ${view.name}`}
                onClick={() =>
                  start(async () => {
                    const r = await deleteView(view.id)
                    if (!r.ok) setError(r.message)
                    else router.push(base)
                  })
                }
              >
                <span aria-hidden="true">&times;</span>
              </button>
            ) : null}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setColsOpen(true)}>
          Columns
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSaveOpen(true)}>
          Save view
        </Button>
        {canEdit ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>
              New contact
            </Button>
            <LinkButton href={`${base}/import`}>Import CSV</LinkButton>
            <LinkButton href={`${base}/fields`}>Custom fields</LinkButton>
          </>
        ) : null}
        <LinkButton href={`${base}/duplicates`}>Possible duplicates</LinkButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Dialog
        open={colsOpen}
        onClose={() => setColsOpen(false)}
        title="Columns"
        footer={
          <>
            <Button variant="secondary" onClick={() => setColsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyColumns} disabled={cols.length === 0}>
              Apply
            </Button>
          </>
        }
      >
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Visible columns</legend>
          {allCols.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cols.includes(c)}
                onChange={(e) => setCols((list) => (e.target.checked ? [...list, c] : list.filter((x) => x !== c)))}
              />
              {colLabel(c)}
            </label>
          ))}
        </fieldset>
      </Dialog>

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save view"
        description="Saves the current filters and columns."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={!name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await saveView(name.trim(), shared)
                  if (!r.ok) {
                    setError(r.message)
                    return
                  }
                  setSaveOpen(false)
                  const p = new URLSearchParams(currentQuery)
                  p.set('sv', r.data)
                  p.set('cols', columns.join(','))
                  router.push(`${base}?${p.toString()}`)
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          {canEdit ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Share with the workspace
            </label>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New contact"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await createContact(draft)
                  if (!r.ok) {
                    setError(r.message)
                    return
                  }
                  setNewOpen(false)
                  router.push(`${base}/${r.data}`)
                })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {(['email', 'phone', 'first_name', 'last_name', 'company'] as const).map((k) => (
            <Input
              key={k}
              label={COLUMN_LABELS[k] ?? (k === 'first_name' ? 'First name' : 'Last name')}
              type={k === 'email' ? 'email' : 'text'}
              value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          ))}
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
