'use client'

import Link from 'next/link'
import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { cx, focusRing } from '@/components/ui'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/crm/import'
import { displayName, memberName, STATUS_LABELS, type ActionResult, type Contact, type MemberLite } from './types'

export const BOARD_LIMIT = 200

/**
 * Kanban by lead_status (doc 04 section 1.2). Native drag events move a card
 * between columns; with the keyboard, focus a card and press Left or Right
 * arrow to move it one column. Moves are optimistic and roll back on error.
 */
export function KanbanBoard({
  slug,
  columns: initial,
  members,
  canEdit,
  listHref,
  move,
}: {
  slug: string
  columns: Record<LeadStatus, Contact[]>
  members: MemberLite[]
  canEdit: boolean
  /** List view URL with the same filters; the column status is added for "show in list". */
  listHref: string
  move: (contactId: string, to: LeadStatus) => Promise<ActionResult<unknown>>
}) {
  const [cols, setCols] = useState(initial)
  const [over, setOver] = useState<LeadStatus | null>(null)
  const [live, setLive] = useState('')

  function locate(id: string): LeadStatus | null {
    return LEAD_STATUSES.find((s) => cols[s].some((c) => c.id === id)) ?? null
  }

  async function moveCard(id: string, to: LeadStatus, focusAfter = false) {
    const from = locate(id)
    if (!from || from === to) return
    const card = cols[from].find((c) => c.id === id)!
    const before = cols
    setCols((c) => ({ ...c, [from]: c[from].filter((x) => x.id !== id), [to]: [{ ...card, lead_status: to }, ...c[to]] }))
    setLive(`${displayName(card)} moved to ${STATUS_LABELS[to]}`)
    if (focusAfter) window.requestAnimationFrame(() => document.getElementById(`card-${id}`)?.focus())
    const r = await move(id, to)
    if (!r.ok) {
      setCols(before)
      setLive(`Could not move ${displayName(card)}: ${r.message}`)
    }
  }

  function onKey(e: KeyboardEvent<HTMLElement>, id: string, status: LeadStatus) {
    if (!canEdit) return
    const i = LEAD_STATUSES.indexOf(status)
    const to = e.key === 'ArrowRight' ? LEAD_STATUSES[i + 1] : e.key === 'ArrowLeft' ? LEAD_STATUSES[i - 1] : undefined
    if (!to) return
    e.preventDefault()
    void moveCard(id, to, true)
  }

  function onDrop(e: DragEvent<HTMLElement>, to: LeadStatus) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) void moveCard(id, to)
  }

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {canEdit ? (
        <p className="mb-2 text-sm text-muted">Drag a card to change its status, or focus a card and use the Left and Right arrow keys.</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {LEAD_STATUSES.map((s) => (
          <section
            key={s}
            aria-label={STATUS_LABELS[s]}
            data-testid={`column-${s}`}
            onDragOver={(e) => {
              if (!canEdit) return
              e.preventDefault()
              setOver(s)
            }}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={(e) => canEdit && onDrop(e, s)}
            className={cx('flex min-h-40 flex-col gap-2 rounded-md border border-border p-2', over === s && 'bg-surface-muted')}
          >
            <h2 className="text-sm font-semibold">
              {STATUS_LABELS[s]} <span className="text-muted">({cols[s].length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {cols[s].map((c) => (
                <li
                  key={c.id}
                  id={`card-${c.id}`}
                  tabIndex={0}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', c.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onKeyDown={(e) => onKey(e, c.id, s)}
                  aria-roledescription={canEdit ? 'Draggable card' : undefined}
                  className={cx('rounded-md border border-border bg-surface p-2 text-sm', focusRing, canEdit && 'cursor-grab')}
                >
                  <Link href={`/w/${slug}/contacts/${c.id}`} className="font-medium text-accent">
                    {displayName(c)}
                  </Link>
                  {c.company ? <p className="text-muted">{c.company}</p> : null}
                  <p className="text-xs text-muted">{memberName(members, c.owner_id)}</p>
                </li>
              ))}
            </ul>
            {cols[s].length >= BOARD_LIMIT ? (
              <Link href={`${listHref}${listHref.includes('?') ? '&' : '?'}status=${s}`} className="text-xs text-accent">
                Show all in list
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  )
}
