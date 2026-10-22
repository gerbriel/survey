'use client'

import { useState } from 'react'
import { lintDefinition, type LintIssue, type LogicRule, type SurveyDefinition, type Theme } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { addEnding } from '@/lib/builder/ops'
import { OPERATOR_LABELS } from './ConditionEditor'
import { Check, Section, TextArea } from './fields'
import { plain } from './model'
import { ThemeEditor } from './ThemeEditor'
import type { Commit, Selection } from './types'

const LOGIC_CODES = new Set(['logic_ref', 'logic_operator', 'logic_depth', 'jump_backward', 'randomized_page_jump', 'calc_ref', 'calc_cycle', 'scored_calc_use'])

function describeRule(def: SurveyDefinition, r: LogicRule): string {
  const q = (id: string) => plain(def.questions[id]?.label.text, 30) || id
  const page = (id: string) => {
    const i = def.pages.findIndex((p) => p.id === id)
    return i >= 0 ? `page ${i + 1}` : `missing page ${id}`
  }
  const ending = (id: string) => {
    const i = def.endings.findIndex((e) => e.id === id)
    return i === 0 ? 'the default ending' : i > 0 ? `ending ${i + 1}` : `missing ending ${id}`
  }
  const leafCount = JSON.stringify(r.when).split('"op"').length - 1
  const ops = [...JSON.stringify(r.when).matchAll(/"op":"([a-z_]+)"/g)].map((m) => OPERATOR_LABELS[m[1] as keyof typeof OPERATOR_LABELS] ?? m[1])
  const cond = leafCount ? ` when ${leafCount} condition${leafCount > 1 ? 's' : ''} (${[...new Set(ops)].join(', ')})` : ' always'
  switch (r.kind) {
    case 'show_question':
      return `Show "${q(r.target_id)}"${cond}`
    case 'hide_question':
      return `Hide "${q(r.target_id)}"${cond}`
    case 'show_page':
      return `Show ${page(r.target_id)}${cond}`
    case 'jump':
      return `After ${page(r.from_page_id)}, go to ${'page_id' in r.to ? page(r.to.page_id) : ending(r.to.ending_id)}${cond}`
    case 'set_ending':
      return `Use ${ending(r.ending_id)}${cond}`
  }
}

/** Nothing selected: survey settings, theme, endings and the logic overview (doc 03 section 6). */
export function SurveyPanel({
  definition: def,
  commit,
  readOnly,
  onSelect,
  workspaceTheme,
  hasWorkspaceLogo,
  workspaceId,
  surveyId,
  imageUploadUrl,
}: {
  definition: SurveyDefinition
  commit: Commit
  readOnly: boolean
  onSelect: (s: Selection) => void
  workspaceTheme: Theme
  hasWorkspaceLogo: boolean
  workspaceId: string
  surveyId: string
  imageUploadUrl?: string | null
}) {
  const [tab, setTab] = useState('settings')
  const s = def.settings
  const set = (patch: Partial<SurveyDefinition['settings']>, key?: string) => {
    const next = { ...s, ...patch }
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k]
    commit({ ...def, settings: next }, key)
  }
  const calcs = Object.values(def.questions).filter((q) => q.type === 'calculated')

  const settings = (
    <div className="flex flex-col gap-4">
      <Input label="Survey title" hint="Shown to respondents." value={s.title} disabled={readOnly} onChange={(e) => set({ title: e.target.value }, 'settings:title')} />
      <TextArea
        label="Introduction"
        value={s.description?.text ?? ''}
        disabled={readOnly}
        onChange={(e) => set({ description: e.target.value ? { format: 'md-lite', text: e.target.value } : undefined }, 'settings:intro')}
      />
      <Check label="One question per screen" checked={s.one_question_per_screen} disabled={readOnly} onChange={(v) => set({ one_question_per_screen: v })} />
      <Check label="Show progress" checked={s.show_progress} disabled={readOnly} onChange={(v) => set({ show_progress: v })} />
      <Select
        label="Progress style"
        options={[
          { value: 'bar', label: 'Bar' },
          { value: 'steps', label: 'Steps' },
          { value: 'percent', label: 'Percent' },
          { value: 'none', label: 'None' },
        ]}
        value={def.theme.progress.style}
        disabled={readOnly}
        onChange={(e) => commit({ ...def, theme: { ...def.theme, progress: { ...def.theme.progress, style: e.target.value as Theme['progress']['style'] } } })}
      />
      <Check label="Number the questions" checked={s.show_question_numbers} disabled={readOnly} onChange={(v) => set({ show_question_numbers: v })} />
      <Check label="Allow going back" checked={s.allow_back} disabled={readOnly} onChange={(v) => set({ allow_back: v })} />
      <Check label="Save partial answers as respondents go" checked={s.autosave_partial} disabled={readOnly} onChange={(v) => set({ autosave_partial: v })} />
      <Check
        label="Shuffle page order"
        hint="All pages are shuffled. Jump rules cannot start from a shuffled page."
        checked={!!s.randomize_pages}
        disabled={readOnly}
        onChange={(v) => set({ randomize_pages: v ? { page_ids: def.pages.map((p) => p.id) } : undefined })}
      />
      <Section title="Buttons">
        {(['start', 'next', 'back', 'submit'] as const).map((b) => (
          <Input
            key={b}
            label={b === 'start' ? 'Start (optional)' : b[0]?.toUpperCase() + b.slice(1)}
            value={def.theme.button_text[b] ?? ''}
            disabled={readOnly}
            onChange={(e) => {
              const next = { ...def.theme.button_text, [b]: e.target.value }
              if (b === 'start' && !e.target.value) delete next.start
              commit({ ...def, theme: { ...def.theme, button_text: next } }, `theme:button:${b}`)
            }}
          />
        ))}
      </Section>
      <Section title="Identity">
        <p className="text-xs text-muted">
          {def.identity.email_question_id
            ? `Contacts are matched by "${plain(def.questions[def.identity.email_question_id]?.label.text, 40)}".`
            : 'No identity question. Mark an email question as the identity key in its settings.'}
        </p>
        <Check
          label="Trust email and contact in the link"
          hint="When on, ?email= and ?contact= on the link may create or link a contact, shown as unverified."
          checked={s.trust_hidden_identity}
          disabled={readOnly}
          onChange={(v) => set({ trust_hidden_identity: v })}
        />
      </Section>
      <Section title="Quiz">
        <Select
          label="Score calculation"
          hint="A hidden calculation using score() or correct(). Leave empty for a regular survey."
          placeholder="Not a quiz"
          options={calcs.map((q) => ({ value: q.id, label: plain(q.label.text, 40) || q.question_key }))}
          value={s.quiz?.score_calc_id ?? ''}
          disabled={readOnly}
          onChange={(e) => set({ quiz: e.target.value ? { score_calc_id: e.target.value, show_correct_answers: s.quiz?.show_correct_answers ?? false } : undefined })}
        />
        {s.quiz ? (
          <Check
            label="Show correct answers at the end"
            checked={s.quiz.show_correct_answers}
            disabled={readOnly}
            onChange={(v) => s.quiz && set({ quiz: { ...s.quiz, show_correct_answers: v } })}
          />
        ) : null}
      </Section>
    </div>
  )

  const endings = (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {def.endings.map((e, i) => (
          <li key={e.id}>
            <Button variant="ghost" size="sm" onClick={() => onSelect({ kind: 'ending', id: e.id })}>
              {i === 0 ? 'Default ending' : `Ending ${i + 1}`}: {plain(e.title?.text || e.message.text, 40)}
            </Button>
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            const r = addEnding(def)
            commit(r.definition)
            onSelect({ kind: 'ending', id: r.id })
          }}
        >
          Add ending
        </Button>
      ) : null}
    </div>
  )

  const issues: LintIssue[] = tab === 'logic' ? lintDefinition(def).issues.filter((i) => LOGIC_CODES.has(i.code)) : []
  const logic = (
    <div className="flex flex-col gap-3">
      {def.logic.length === 0 ? <p className="text-sm text-muted">No logic rules yet. Add them from a question, page or ending.</p> : null}
      <ul className="flex flex-col gap-1 text-sm">
        {def.logic.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              onClick={() => {
                if (r.kind === 'show_question' || r.kind === 'hide_question') onSelect({ kind: 'question', id: r.target_id })
                else if (r.kind === 'show_page') onSelect({ kind: 'page', id: r.target_id })
                else if (r.kind === 'jump') onSelect({ kind: 'page', id: r.from_page_id })
                else onSelect({ kind: 'ending', id: r.ending_id })
              }}
            >
              {describeRule(def, r)}
            </button>
          </li>
        ))}
      </ul>
      {issues.length ? (
        <ul role="status" className="flex flex-col gap-1 rounded-md border border-danger p-2 text-xs">
          {issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      ) : def.logic.length ? (
        <p className="text-xs text-muted">No broken references.</p>
      ) : null}
    </div>
  )

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Survey</h2>
      <Tabs
        label="Survey settings"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'settings', label: 'Settings', content: settings },
          {
            id: 'theme',
            label: 'Theme',
            content: (
              <ThemeEditor
                theme={def.theme}
                disabled={readOnly}
                hasWorkspaceLogo={hasWorkspaceLogo}
                workspaceId={workspaceId}
                surveyId={surveyId}
                imageUploadUrl={imageUploadUrl}
                onChange={(theme, key) => commit({ ...def, theme }, key)}
                onReset={() => commit({ ...def, theme: workspaceTheme })}
              />
            ),
          },
          { id: 'endings', label: 'Endings', content: endings },
          { id: 'logic', label: 'Logic', content: logic },
        ]}
      />
    </div>
  )
}
