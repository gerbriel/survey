'use client'

import { useState } from 'react'
import { QUESTION_TYPES, type LogicRule, type Question, type QuestionType, type SurveyDefinition } from '@/lib/survey'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { changeType, newId, pageOf, questionsBefore, removeRule, updateQuestion, upsertRule } from '@/lib/builder/ops'
import { ConditionEditor, fieldChoices, isEmptyCondition } from './ConditionEditor'
import { Check, TextArea } from './fields'
import {
  CONTACT_FIELD_TYPES,
  CORE_CONTACT_FIELDS,
  contactFieldTarget,
  contactFieldValue,
  defaultSettings,
  NO_REQUIRED_TYPES,
  sameStorage,
  TYPE_LABELS,
} from './model'
import { PipingPicker } from './PipingPicker'
import { TypeSettings } from './TypeSettings'
import { ValidationSettings } from './ValidationSettings'
import type { Commit } from './types'

export function QuestionPanel({
  definition: def,
  id,
  commit,
  readOnly,
  contactFields,
  pixelConsentMode,
  publishedKeys,
}: {
  definition: SurveyDefinition
  id: string
  commit: Commit
  readOnly: boolean
  contactFields: { key: string; label: string }[]
  pixelConsentMode: 'banner' | 'notice' | 'in_form'
  publishedKeys: ReadonlySet<string>
}) {
  const [tab, setTab] = useState('settings')
  const q = def.questions[id]
  if (!q) return <p className="text-sm text-muted">Select a question.</p>
  const at = pageOf(def, id)
  const pageIndex = at?.pageIndex ?? null
  const put = (next: Question, key?: string) => commit(updateQuestion(def, id, () => next), key)

  const isIdentityEmail = def.identity.email_question_id === id
  const isIdentityPhone = def.identity.phone_question_id === id

  const settings = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          Key <code className="font-mono">{q.question_key}</code>
        </span>
        {publishedKeys.has(q.question_key) ? <Badge>Published</Badge> : null}
      </div>
      <Select
        label="Type"
        hint="Changing to a type stored differently gives the question a new report key once it has been published."
        options={QUESTION_TYPES.map((t) => ({ value: t, label: `${TYPE_LABELS[t]}${sameStorage(t, q.type) ? '' : ' (new storage)'}` }))}
        value={q.type}
        disabled={readOnly}
        onChange={(e) => {
          const t = e.target.value as QuestionType
          commit(changeType(def, id, t, defaultSettings(t, def), publishedKeys))
        }}
      />
      <TextArea label="Label" value={q.label.text} disabled={readOnly} onChange={(e) => put({ ...q, label: { format: 'md-lite', text: e.target.value } }, `label:${id}`)} />
      <PipingPicker definition={def} pageIndex={pageIndex} disabled={readOnly} onInsert={(t) => put({ ...q, label: { format: 'md-lite', text: `${q.label.text}${t}` } })} />
      <TextArea
        label="Help text"
        value={q.help?.text ?? ''}
        disabled={readOnly}
        onChange={(e) => {
          const { help: _h, ...rest } = q
          void _h
          put((e.target.value ? { ...rest, help: { format: 'md-lite', text: e.target.value } } : rest) as Question, `help:${id}`)
        }}
      />
      {!NO_REQUIRED_TYPES.has(q.type) ? <Check label="Required" checked={q.required} disabled={readOnly} onChange={(v) => put({ ...q, required: v })} /> : null}
      <TypeSettings question={q} definition={def} pageIndex={pageIndex} onChange={put} disabled={readOnly} />
      {q.type === 'consent' ? (
        <Check
          label="Gates tracking pixels"
          checked={q.settings.gates_tracking}
          disabled={readOnly}
          hint={
            pixelConsentMode === 'in_form'
              ? 'Pixels load only after this box is checked.'
              : `Only takes effect when the workspace consent mode is "in form". It is "${pixelConsentMode}" now.`
          }
          onChange={(v) => put({ ...q, settings: { ...q.settings, gates_tracking: v } })}
        />
      ) : null}
      {q.type === 'email' ? (
        <Check
          label="Identity key: match responses to contacts by this email"
          checked={isIdentityEmail}
          disabled={readOnly}
          onChange={(v) => {
            const identity = { ...def.identity }
            if (v) identity.email_question_id = id
            else delete identity.email_question_id
            commit({ ...def, identity })
          }}
        />
      ) : null}
      {q.type === 'phone' ? (
        <Check
          label="Secondary identity key (phone)"
          checked={isIdentityPhone}
          disabled={readOnly}
          onChange={(v) => {
            const identity = { ...def.identity }
            if (v) identity.phone_question_id = id
            else delete identity.phone_question_id
            commit({ ...def, identity })
          }}
        />
      ) : null}
      {CONTACT_FIELD_TYPES.has(q.type) ? (
        <Select
          label="Save to contact field"
          hint="Fills the contact field when it is empty."
          placeholder="Do not save"
          options={[
            ...CORE_CONTACT_FIELDS.map((f) => ({ value: f.value, label: f.label })),
            ...contactFields.map((f) => ({ value: `custom:${f.key}`, label: `Custom: ${f.label}` })),
          ]}
          value={contactFieldValue(q.contact_field)}
          disabled={readOnly}
          onChange={(e) => {
            const target = contactFieldTarget(e.target.value)
            const { contact_field: _c, ...rest } = q
            void _c
            put((target ? { ...rest, contact_field: target } : rest) as Question)
          }}
        />
      ) : null}
      <Check
        label="Contains personal data"
        hint="Anonymizing a respondent deletes these answers."
        checked={!!q.pii}
        disabled={readOnly}
        onChange={(v) => {
          const { pii: _p, ...rest } = q
          void _p
          put((v ? { ...rest, pii: true } : rest) as Question)
        }}
      />
    </div>
  )

  const rule = def.logic.find((r): r is Extract<LogicRule, { kind: 'show_question' | 'hide_question' }> => (r.kind === 'show_question' || r.kind === 'hide_question') && r.target_id === id)
  const choices = at ? fieldChoices(def, questionsBefore(def, at.page.id, id)) : []
  const logic = (
    <div className="flex flex-col gap-3">
      <Select
        label="Visibility"
        options={[
          { value: 'show_question', label: 'Show this question only when' },
          { value: 'hide_question', label: 'Hide this question when' },
        ]}
        value={rule?.kind ?? 'show_question'}
        disabled={readOnly || !rule}
        onChange={(e) => rule && commit(upsertRule(def, { ...rule, kind: e.target.value as 'show_question' | 'hide_question' }))}
      />
      <ConditionEditor
        value={rule?.when}
        choices={choices}
        disabled={readOnly}
        onChange={(when) => {
          if (isEmptyCondition(when)) {
            if (rule) commit(removeRule(def, rule.id))
            return
          }
          commit(upsertRule(def, rule ? { ...rule, when } : { id: newId(def, 'logic'), kind: 'show_question', target_id: id, when }), `logic:${id}`)
        }}
      />
      <p className="text-xs text-muted">Conditions can only use questions that come before this one.</p>
    </div>
  )

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">{TYPE_LABELS[q.type]}</h2>
      <Tabs
        label="Question settings"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'settings', label: 'Settings', content: settings },
          { id: 'validation', label: 'Validation', content: <ValidationSettings question={q} onChange={put} disabled={readOnly} /> },
          { id: 'logic', label: 'Logic', content: logic },
        ]}
      />
    </div>
  )
}
