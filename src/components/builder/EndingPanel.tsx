'use client'

import type { Ending, LogicRule, SurveyDefinition } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { newId, orderedQuestions, removeEnding, removeRule, updateEnding, upsertRule } from '@/lib/builder/ops'
import { ConditionEditor, fieldChoices, isEmptyCondition } from './ConditionEditor'
import { Check, NumberField, Section, TextArea } from './fields'
import { PipingPicker } from './PipingPicker'
import type { Commit, Selection } from './types'

/** Endings editor (doc 03 section 2): message, redirect, score, summary, and when to use it. */
export function EndingPanel({
  definition: def,
  id,
  commit,
  readOnly,
  onSelect,
}: {
  definition: SurveyDefinition
  id: string
  commit: Commit
  readOnly: boolean
  onSelect: (s: Selection) => void
}) {
  const i = def.endings.findIndex((e) => e.id === id)
  const e = def.endings[i]
  if (!e) return <p className="text-sm text-muted">Select an ending.</p>
  const put = (patch: Partial<Ending>, key?: string) => commit(updateEnding(def, id, patch), key ? `ending:${id}:${key}` : undefined)
  const rule = def.logic.find((r): r is Extract<LogicRule, { kind: 'set_ending' }> => r.kind === 'set_ending' && r.ending_id === id)
  const choices = fieldChoices(def, orderedQuestions(def))
  const redirectBad = !!e.redirect_url && !/^https?:\/\//i.test(e.redirect_url)
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">{i === 0 ? 'Default ending' : `Ending ${i + 1}`}</h2>
      <Input label="Title" value={e.title?.text ?? ''} disabled={readOnly} onChange={(ev) => put({ title: ev.target.value ? { format: 'md-lite', text: ev.target.value } : undefined }, 'title')} />
      <TextArea label="Message" rows={4} value={e.message.text} disabled={readOnly} onChange={(ev) => put({ message: { format: 'md-lite', text: ev.target.value } }, 'message')} />
      <PipingPicker definition={def} pageIndex={null} disabled={readOnly} onInsert={(t) => put({ message: { format: 'md-lite', text: `${e.message.text}${t}` } })} />
      <Check label="Show the score" checked={e.show_score} disabled={readOnly} onChange={(v) => put({ show_score: v })} />
      <Check label="Show a summary of answers" checked={e.show_summary} disabled={readOnly} onChange={(v) => put({ show_summary: v })} />
      <Input
        label="Redirect to a web address"
        type="url"
        hint="Must start with https:// or http://. Leave empty to stay on the thank-you screen."
        error={redirectBad ? 'The address must start with https:// or http://.' : undefined}
        value={e.redirect_url ?? ''}
        disabled={readOnly}
        onChange={(ev) => put({ redirect_url: ev.target.value || undefined }, 'redirect')}
      />
      {e.redirect_url ? (
        <>
          <NumberField label="Seconds before redirect" min={0} max={30} value={e.redirect_delay_seconds} disabled={readOnly} onChange={(v) => put({ redirect_delay_seconds: v })} />
          <Check label="Pass the survey link parameters along" checked={!!e.redirect_pass_params} disabled={readOnly} onChange={(v) => put({ redirect_pass_params: v || undefined })} />
        </>
      ) : null}
      {i > 0 ? (
        <Section title="Use this ending when">
          <ConditionEditor
            value={rule?.when}
            choices={choices}
            disabled={readOnly}
            onChange={(when) => {
              if (isEmptyCondition(when)) return rule ? commit(removeRule(def, rule.id)) : undefined
              commit(upsertRule(def, rule ? { ...rule, when } : { id: newId(def, 'logic'), kind: 'set_ending', ending_id: id, when, order: i }), `ending:${id}:rule`)
            }}
          />
        </Section>
      ) : (
        <p className="text-xs text-muted">The default ending shows when no other ending matches.</p>
      )}
      {!readOnly && def.endings.length > 1 ? (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            commit(removeEnding(def, id))
            onSelect({ kind: 'survey' })
          }}
        >
          Delete this ending
        </Button>
      ) : null}
    </div>
  )
}
