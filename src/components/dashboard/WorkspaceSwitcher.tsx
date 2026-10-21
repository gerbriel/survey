'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import type { WorkspaceRole } from '@/types/db-helpers'
import { cx, focusRing } from '@/components/ui/cx'
import { RoleBadge } from './RoleBadge'

export type SwitcherWorkspace = { slug: string; name: string; role: WorkspaceRole; archived: boolean }

/**
 * Disclosure menu of the user's workspaces with role badges (doc 05 section
 * 4.4). Plain links, so middle click opens a second department in a new tab.
 * Archived workspaces sit behind "Show archived" (section 1.3).
 */
export function WorkspaceSwitcher({ current, workspaces }: { current: SwitcherWorkspace; workspaces: SwitcherWorkspace[] }) {
  const [open, setOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const active = workspaces.filter((w) => !w.archived)
  const archived = workspaces.filter((w) => w.archived)
  const list = showArchived ? [...active, ...archived] : active

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-fg hover:bg-surface-muted',
          focusRing,
        )}
      >
        <span className="truncate">{current.name}</span>
        <span className="sr-only">, switch workspace</span>
        <span aria-hidden="true" className="text-muted">
          &#9662;
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute left-0 z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-2 shadow-lg"
        >
          <p className="px-2 pb-1 text-xs font-medium text-muted">Your workspaces</p>
          <ul className="max-h-72 overflow-y-auto">
            {list.map((w) => (
              <li key={w.slug}>
                <Link
                  href={`/w/${encodeURIComponent(w.slug)}`}
                  aria-current={w.slug === current.slug ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(
                    'flex items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-surface-muted',
                    focusRing,
                    w.slug === current.slug && 'font-semibold',
                  )}
                >
                  <span className="truncate">
                    {w.name}
                    {w.archived ? <span className="text-muted"> (archived)</span> : null}
                  </span>
                  <RoleBadge role={w.role} />
                </Link>
              </li>
            ))}
          </ul>
          {archived.length > 0 ? (
            <label className="mt-2 flex items-center gap-2 border-t border-border px-2 pt-2 text-sm text-muted">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived ({archived.length})
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
