'use client'

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx, focusRing } from './cx'

export type TabItem = { id: string; label: ReactNode; content: ReactNode }

/**
 * WAI-ARIA tabs with automatic activation: arrow keys, Home and End move
 * between tabs; only the active tab is in the tab order.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  /** Accessible name for the tab list. */
  label: string
}) {
  const base = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  )

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = items.length - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1
    if (e.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    refs.current[next]?.focus()
  }

  const active = items[activeIndex]

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {items.map((t, i) => {
          const selected = i === activeIndex
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                focusRing,
                selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className={cx('py-4', focusRing)}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  )
}
