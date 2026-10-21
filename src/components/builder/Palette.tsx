'use client'

import type { QuestionType } from '@/lib/survey'
import { cx, focusRing } from '@/components/ui/cx'
import { DND_TYPE } from './dnd'
import { PALETTE_GROUPS, TYPE_LABELS } from './model'

/**
 * Left pane (doc 03 section 6): question and block types grouped like the
 * doc. Click adds after the selection; drag drops onto the canvas.
 */
export function Palette({ onAdd, disabled }: { onAdd: (type: QuestionType) => void; disabled?: boolean }) {
  return (
    <nav aria-label="Question types" className="flex flex-col gap-4 text-sm">
      {PALETTE_GROUPS.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</h3>
          <ul className="flex flex-col gap-1">
            {g.types.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  disabled={disabled}
                  draggable={!disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, t)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onAdd(t)}
                  className={cx(
                    'w-full cursor-grab rounded-md border border-border bg-surface px-2 py-1.5 text-left hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50',
                    focusRing,
                  )}
                >
                  {TYPE_LABELS[t]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
