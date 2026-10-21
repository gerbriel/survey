'use client'

import { useEffect, useState } from 'react'
import { orderOptions, type ChoiceOption, type RankingQuestion } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { joinIds } from './shared'

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Display order: ranked ids first, then the rest in (seeded) option order. */
export function rankingOrder(options: ChoiceOption[], ranked: string[]): ChoiceOption[] {
  const byId = new Map(options.map((o) => [o.id, o]))
  const head = ranked.map((id) => byId.get(id)).filter((o): o is ChoiceOption => o !== undefined)
  const seen = new Set(head.map((o) => o.id))
  return [...head, ...options.filter((o) => !seen.has(o.id))]
}

type Dir = 'up' | 'down'

/**
 * Ranking with Move up and Move down buttons on every item (keyboard
 * alternative to drag, doc 03 section 5). Decision: the answer is the first
 * N ids of the list (N = rank_top_n, else all) and is set on the first move
 * or by "Use this order"; until then the question is unanswered.
 */
export function RankingInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<RankingQuestion>) {
  const options = orderOptions(question, ctx.seed)
  const ranked = asIds(value)
  const list = rankingOrder(options, ranked)
  const need = question.settings.rank_top_n !== undefined ? Math.min(question.settings.rank_top_n, options.length) : options.length
  const [announce, setAnnounce] = useState('')
  const [focusTarget, setFocusTarget] = useState<{ id: string; dir: Dir } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const instructionsId = `${inputId}-how`

  useEffect(() => {
    if (focusTarget) document.getElementById(`${inputId}-${focusTarget.id}-${focusTarget.dir}`)?.focus()
  }, [focusTarget, value, inputId])

  const commit = (next: ChoiceOption[], moved: ChoiceOption | null) => {
    onChange(next.slice(0, need).map((o) => o.id))
    if (moved) {
      const pos = next.findIndex((o) => o.id === moved.id) + 1
      setAnnounce(fmt(ctx.strings.rankingMoved, { label: moved.label, position: pos, total: next.length }))
    } else {
      setAnnounce(ctx.strings.rankingAccepted)
    }
  }

  const move = (index: number, dir: Dir) => {
    const target = dir === 'up' ? index - 1 : index + 1
    const item = list[index]
    if (!item || target < 0 || target >= list.length) return
    const next = list.slice()
    next.splice(index, 1)
    next.splice(target, 0, item)
    commit(next, item)
    setFocusTarget({ id: item.id, dir })
  }

  const dropOn = (targetId: string) => {
    if (!dragging || dragging === targetId) return
    const from = list.findIndex((o) => o.id === dragging)
    const to = list.findIndex((o) => o.id === targetId)
    const item = list[from]
    if (!item || to < 0) return
    const next = list.slice()
    next.splice(from, 1)
    next.splice(to, 0, item)
    commit(next, item)
    setDragging(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={instructionsId} className="text-sm text-muted">
        {ctx.strings.rankingInstructions}
        {question.settings.rank_top_n !== undefined ? ` ${fmt(ctx.strings.rankingTopN, { n: need })}` : ''}
      </p>
      <ol
        id={inputId}
        aria-labelledby={labelId}
        aria-describedby={joinIds(describedBy, instructionsId)}
        data-invalid={invalid || undefined}
        className="flex flex-col gap-2"
      >
        {list.map((o, i) => {
          const isRanked = ranked.length > 0 && i < need
          const outside = i >= need
          return (
            <li
              key={o.id}
              draggable
              onDragStart={() => setDragging(o.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(o.id)}
              onDragEnd={() => setDragging(null)}
              className={cx(
                'flex min-h-11 items-center gap-3 rounded-[var(--sv-radius)] border border-border bg-[var(--sv-surface)] px-3 py-1',
                isRanked && 'border-[var(--sv-primary)]',
                outside && 'opacity-70',
                dragging === o.id && 'opacity-50',
              )}
            >
              <span aria-hidden="true" className="w-6 text-center font-semibold">
                {outside ? '' : i + 1}
              </span>
              <span className="flex-1">
                {o.label}
                {outside ? <span className="sr-only">, not ranked</span> : <span className="sr-only">, rank {i + 1}</span>}
              </span>
              {(['up', 'down'] as const).map((dir) => {
                const edge = dir === 'up' ? i === 0 : i === list.length - 1
                return (
                  <Button
                    key={dir}
                    id={`${inputId}-${o.id}-${dir}`}
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11"
                    aria-label={fmt(dir === 'up' ? ctx.strings.rankingMoveUp : ctx.strings.rankingMoveDown, { label: o.label })}
                    // aria-disabled keeps focus on the button at the ends of the list.
                    aria-disabled={edge || undefined}
                    onClick={() => (edge ? undefined : move(i, dir))}
                  >
                    <span aria-hidden="true">{dir === 'up' ? '↑' : '↓'}</span>
                  </Button>
                )
              })}
            </li>
          )
        })}
      </ol>
      {ranked.length === 0 ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => commit(list, null)}>
          {ctx.strings.rankingAccept}
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  )
}
