'use client'

import type { LogicRule, SurveyDefinition } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { newId, questionsBefore, removeRule, updatePage, upsertRule } from '@/lib/builder/ops'
import { ConditionEditor, fieldChoices, isEmptyCondition } from './ConditionEditor'
import { Check, Section, TextArea } from './fields'
import { plain } from './model'
import type { Commit } from './types'

type Jump = Extract<LogicRule, { kind: 'jump' }>

/** Page settings and page logic: "Show this page when" and ordered "After this page" jumps (forward only). */
export function PagePanel({ definition: def, id, commit, readOnly }: { definition: SurveyDefinition; id: string; commit: Commit; readOnly: boolean }) {
  const pi = def.pages.findIndex((p) => p.id === id)
  const page = def.pages[pi]
  if (!page) return <p className="text-sm text-muted">Select a page.</p>
  const k = (n: string) => `page:${id}:${n}`
  const before = fieldChoices(def, questionsBefore(def, id))
  const through = fieldChoices(def, questionsBefore(def, def.pages[pi + 1]?.id ?? '__end__'))
  const showRule = def.logic.find((r): r is Extract<LogicRule, { kind: 'show_page' }> => r.kind === 'show_page' && r.target_id === id)
  const jumps = def.logic.filter((r): r is Jump => r.kind === 'jump' && r.from_page_id === id).sort((a, b) => a.order - b.order)
  const targets = [
    ...def.pages.slice(pi + 1).map((p, j) => ({ value: `page:${p.id}`, label: `Page ${pi + j + 2}${p.title ? `: ${plain(p.title, 30)}` : ''}` })),
    ...def.endings.map((e, j) => ({ value: `ending:${e.id}`, label: `${j === 0 ? 'Default ending' : `Ending ${j + 1}`}` })),
  ]
  const reorder = (list: Jump[]) => {
    let next = def
    list.forEach((r, i) => (next = upsertRule(next, { ...r, order: i })))
    commit(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">Page {pi + 1}</h2>
      <Input label="Page title" value={page.title ?? ''} disabled={readOnly} onChange={(e) => commit(updatePage(def, id, { title: e.target.value || undefined }), k('title'))} />
      <TextArea
        label="Description"
        value={page.description?.text ?? ''}
        disabled={readOnly}
        onChange={(e) => commit(updatePage(def, id, { description: e.target.value ? { format: 'md-lite', text: e.target.value } : undefined }), k('desc'))}
      />
      <Input label="Next button text" hint="Leave empty to use the survey default." value={page.button_label ?? ''} disabled={readOnly} onChange={(e) => commit(updatePage(def, id, { button_label: e.target.value || undefined }), k('button'))} />
      <Check
        label="Shuffle questions on this page"
        checked={!!page.randomize_questions}
        disabled={readOnly}
        onChange={(v) => commit(updatePage(def, id, { randomize_questions: v ? { pinned_ids: [] } : undefined }))}
      />
      <Section title="Show this page when">
        <ConditionEditor
          value={showRule?.when}
          choices={before}
          disabled={readOnly}
          onChange={(when) => {
            if (isEmptyCondition(when)) return showRule ? commit(removeRule(def, showRule.id)) : undefined
            commit(upsertRule(def, showRule ? { ...showRule, when } : { id: newId(def, 'logic'), kind: 'show_page', target_id: id, when }), k('show'))
          }}
        />
      </Section>
      <Section title="After this page">
        <p className="text-xs text-muted">Rules run in order; the first match decides. Jumps only go forward.</p>
        <ol className="flex flex-col gap-3">
          {jumps.map((r, i) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <Select
                label={`Rule ${i + 1}: go to`}
                options={targets}
                value={'page_id' in r.to ? `page:${r.to.page_id}` : `ending:${r.to.ending_id}`}
                disabled={readOnly}
                onChange={(e) => {
                  const [kind, tid] = e.target.value.split(':') as [string, string]
                  commit(upsertRule(def, { ...r, to: kind === 'page' ? { page_id: tid } : { ending_id: tid } }))
                }}
              />
              <ConditionEditor value={r.when} choices={through} disabled={readOnly} onChange={(when) => commit(upsertRule(def, { ...r, when }), `jump:${r.id}`)} />
              {!readOnly ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => reorder(swap(jumps, i, i - 1))}>
                    Up
                  </Button>
                  <Button size="sm" variant="ghost" disabled={i === jumps.length - 1} onClick={() => reorder(swap(jumps, i, i + 1))}>
                    Down
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => commit(removeRule(def, r.id))}>
                    Remove rule
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {!readOnly ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={targets.length === 0}
            onClick={() => {
              const first = targets[0]
              if (!first) return
              const [kind, tid] = first.value.split(':') as [string, string]
              commit(
                upsertRule(def, {
                  id: newId(def, 'logic'),
                  kind: 'jump',
                  from_page_id: id,
                  to: kind === 'page' ? { page_id: tid } : { ending_id: tid },
                  when: { all: [] },
                  order: jumps.length,
                }),
              )
            }}
          >
            Add jump rule
          </Button>
        ) : null}
      </Section>
    </div>
  )
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list]
  ;[next[a], next[b]] = [next[b] as T, next[a] as T]
  return next
}
