'use client'

import { useState, type DragEvent, type KeyboardEvent } from 'react'
import type { QuestionType, SurveyDefinition } from '@/lib/survey'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cx, focusRing } from '@/components/ui/cx'
import { addPage, duplicateQuestion, movePage, moveQuestion, moveQuestionBy, removePage, removeQuestion, updateQuestion } from '@/lib/builder/ops'
import { DND_PAGE, DND_QUESTION, DND_TYPE, hasType } from './dnd'
import { NO_REQUIRED_TYPES, plain, TYPE_LABELS } from './model'
import type { Commit, Selection } from './types'

type DropTarget = { pageId: string; index: number } | null

/** Index to insert at, from the pointer position over the page's question cards. */
function dropIndex(e: DragEvent<HTMLElement>): number {
  const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-qcard]'))
  for (let i = 0; i < cards.length; i++) {
    const r = (cards[i] as HTMLElement).getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) return i
  }
  return cards.length
}

/**
 * Center pane: pages stacked with headers, question cards with inline label
 * editing, native drag and drop within and across pages, page reorder by
 * dragging the header, and keyboard reorder (Alt plus arrow keys, or the
 * move buttons). Endings are listed after the last page.
 */
export function Canvas({
  definition: def,
  selection,
  onSelect,
  commit,
  onAddType,
  readOnly,
  issueCount,
  breakingIds,
}: {
  definition: SurveyDefinition
  selection: Selection
  onSelect: (s: Selection) => void
  commit: Commit
  onAddType: (type: QuestionType, pageId: string, index: number) => void
  readOnly: boolean
  issueCount: Record<string, number>
  breakingIds: ReadonlySet<string>
}) {
  const [target, setTarget] = useState<DropTarget>(null)
  const [announce, setAnnounce] = useState('')

  function onDragOver(e: DragEvent<HTMLElement>, pageId: string) {
    if (readOnly || !(hasType(e, DND_TYPE) || hasType(e, DND_QUESTION))) return
    e.preventDefault()
    const index = dropIndex(e)
    if (target?.pageId !== pageId || target.index !== index) setTarget({ pageId, index })
  }

  function onDrop(e: DragEvent<HTMLElement>, pageId: string) {
    if (readOnly) return
    const type = e.dataTransfer.getData(DND_TYPE) as QuestionType
    const qid = e.dataTransfer.getData(DND_QUESTION)
    if (!type && !qid) return
    e.preventDefault()
    const index = dropIndex(e)
    setTarget(null)
    if (type) {
      onAddType(type, pageId, index)
      return
    }
    const page = def.pages.find((p) => p.id === pageId)
    const from = page?.question_ids.indexOf(qid) ?? -1
    // Dropping below its own slot on the same page: account for the removal.
    const to = from >= 0 && from < index ? index - 1 : index
    commit(moveQuestion(def, qid, pageId, to))
  }

  function keyMove(e: KeyboardEvent<HTMLElement>, id: string) {
    if (readOnly || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    move(id, e.key === 'ArrowUp' ? -1 : 1)
  }

  function move(id: string, delta: -1 | 1) {
    const next = moveQuestionBy(def, id, delta)
    if (next === def) return
    commit(next)
    const pi = next.pages.findIndex((p) => p.question_ids.includes(id))
    const qi = next.pages[pi]?.question_ids.indexOf(id) ?? 0
    setAnnounce(`Moved to page ${pi + 1}, position ${qi + 1}.`)
    // Keep focus on the moved card after React re-renders it.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-qcard="${id}"]`)?.focus())
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {def.pages.map((page, pi) => {
        const pageSelected = selection.kind === 'page' && selection.id === page.id
        return (
          <section
            key={page.id}
            aria-label={`Page ${pi + 1}`}
            className={cx('rounded-lg border bg-surface', pageSelected ? 'border-accent' : 'border-border')}
            onDragOver={(e) => {
              if (!readOnly && hasType(e, DND_PAGE)) e.preventDefault()
            }}
            onDrop={(e) => {
              const from = e.dataTransfer.getData(DND_PAGE)
              if (!from || readOnly) return
              e.preventDefault()
              const fi = def.pages.findIndex((p) => p.id === from)
              commit(movePage(def, fi, pi))
            }}
          >
            <header
              draggable={!readOnly}
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_PAGE, page.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
            >
              <button
                type="button"
                onClick={() => onSelect({ kind: 'page', id: page.id })}
                className={cx('mr-auto rounded text-left text-sm font-semibold', focusRing)}
                aria-pressed={pageSelected}
              >
                Page {pi + 1}
                {page.title ? <span className="font-normal text-muted">: {plain(page.title, 50)}</span> : null}
              </button>
              {!readOnly ? (
                <>
                  <Button size="sm" variant="ghost" aria-label={`Move page ${pi + 1} up`} disabled={pi === 0} onClick={() => commit(movePage(def, pi, pi - 1))}>
                    Up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move page ${pi + 1} down`}
                    disabled={pi === def.pages.length - 1}
                    onClick={() => commit(movePage(def, pi, pi + 1))}
                  >
                    Down
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Add page after page ${pi + 1}`}
                    onClick={() => {
                      const r = addPage(def, pi)
                      commit(r.definition)
                      onSelect({ kind: 'page', id: r.pageId })
                    }}
                  >
                    Add page
                  </Button>
                  {def.pages.length > 1 ? (
                    <Button size="sm" variant="ghost" aria-label={`Remove page ${pi + 1}`} onClick={() => commit(removePage(def, page.id))}>
                      Remove
                    </Button>
                  ) : null}
                </>
              ) : null}
            </header>
            <ol
              aria-label={`Questions on page ${pi + 1}`}
              className="flex min-h-16 flex-col gap-2 p-3"
              onDragOver={(e) => onDragOver(e, page.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null)
              }}
              onDrop={(e) => onDrop(e, page.id)}
            >
              {page.question_ids.length === 0 ? (
                <li className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
                  Drag a question type here, or click one in the palette.
                </li>
              ) : null}
              {page.question_ids.map((qid, qi) => {
                const q = def.questions[qid]
                if (!q) return null
                const selected = selection.kind === 'question' && selection.id === qid
                const issues = issueCount[qid] ?? 0
                const showLine = target?.pageId === page.id && target.index === qi
                return (
                  <li key={qid} className="flex flex-col gap-2">
                    {showLine ? <div aria-hidden="true" className="h-0.5 rounded bg-accent" /> : null}
                    <div
                      data-qcard={qid}
                      tabIndex={0}
                      role="group"
                      aria-label={`${TYPE_LABELS[q.type]}: ${plain(q.label.text) || 'Untitled'}`}
                      aria-describedby="canvas-keys-hint"
                      draggable={!readOnly}
                      onDragStart={(e) => {
                        e.stopPropagation()
                        e.dataTransfer.setData(DND_QUESTION, qid)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onKeyDown={(e) => keyMove(e, qid)}
                      onClick={() => onSelect({ kind: 'question', id: qid })}
                      className={cx(
                        'flex flex-col gap-2 rounded-md border bg-surface p-3',
                        focusRing,
                        selected ? 'border-accent ring-1 ring-accent' : 'border-border',
                        readOnly ? '' : 'cursor-grab',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge>{TYPE_LABELS[q.type]}</Badge>
                        {q.required && !NO_REQUIRED_TYPES.has(q.type) ? <Badge tone="accent">Required</Badge> : null}
                        {breakingIds.has(qid) ? <Badge tone="warning">Breaking change</Badge> : null}
                        {issues > 0 ? <Badge tone="danger">{issues === 1 ? '1 problem' : `${issues} problems`}</Badge> : null}
                      </div>
                      <label className="sr-only" htmlFor={`label-${qid}`}>
                        Question label
                      </label>
                      <input
                        id={`label-${qid}`}
                        value={q.label.text}
                        readOnly={readOnly}
                        onFocus={() => onSelect({ kind: 'question', id: qid })}
                        onChange={(e) => commit(updateQuestion(def, qid, (x) => ({ ...x, label: { ...x.label, text: e.target.value } })), `label:${qid}`)}
                        className={cx('w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-border', focusRing)}
                      />
                      {!readOnly ? (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" aria-label="Move question up" onClick={(e) => (e.stopPropagation(), move(qid, -1))}>
                            Up
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Move question down" onClick={(e) => (e.stopPropagation(), move(qid, 1))}>
                            Down
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              const r = duplicateQuestion(def, qid)
                              commit(r.definition)
                              onSelect({ kind: 'question', id: r.id })
                            }}
                          >
                            Duplicate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              commit(removeQuestion(def, qid))
                              onSelect({ kind: 'page', id: page.id })
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
              {target?.pageId === page.id && target.index === page.question_ids.length && page.question_ids.length > 0 ? (
                <li aria-hidden="true" className="h-0.5 rounded bg-accent" />
              ) : null}
            </ol>
          </section>
        )
      })}
      <p id="canvas-keys-hint" className="text-xs text-muted">
        Tip: focus a question and press Alt with the up or down arrow to move it, across pages too.
      </p>
      <section aria-label="Endings" className="rounded-lg border border-border bg-surface p-3">
        <h3 className="mb-2 text-sm font-semibold">Endings</h3>
        <ul className="flex flex-col gap-1">
          {def.endings.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect({ kind: 'ending', id: e.id })}
                aria-pressed={selection.kind === 'ending' && selection.id === e.id}
                className={cx('w-full rounded px-2 py-1 text-left text-sm hover:bg-surface-muted', focusRing)}
              >
                {i === 0 ? 'Default ending' : `Ending ${i + 1}`}: {plain(e.title?.text || e.message.text, 60)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
