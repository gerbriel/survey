'use client'

import { isPipeableType, scoredCalcIds, type SurveyDefinition } from '@/lib/survey'
import { Select } from '@/components/ui/Select'
import { plain } from './model'

/**
 * Inserts a piping token (doc 03 section 3): {{q:key}}, {{hidden:param}},
 * {{calc:key}}. Only offers what lint accepts at this spot: pipeable
 * questions on earlier pages (all pages for endings), hidden fields, and
 * calculations (scored ones only in endings).
 */
export function PipingPicker({
  definition: def,
  pageIndex,
  onInsert,
  disabled,
  label = 'Insert answer',
}: {
  definition: SurveyDefinition
  /** Page the text lives on; null for endings. */
  pageIndex: number | null
  onInsert: (token: string) => void
  disabled?: boolean
  label?: string
}) {
  const scored = scoredCalcIds(def)
  const options: { value: string; label: string }[] = []
  def.pages.forEach((p, i) => {
    for (const id of p.question_ids) {
      const q = def.questions[id]
      if (!q || q.type === 'hidden') continue
      if (q.type === 'calculated') {
        if (scored.has(q.id) && pageIndex !== null) continue
        options.push({ value: `{{calc:${q.question_key}}}`, label: `Calculation: ${plain(q.label.text, 40)}` })
        continue
      }
      if (pageIndex !== null && i >= pageIndex) continue
      if (!isPipeableType(q.type)) continue
      options.push({ value: `{{q:${q.question_key}}}`, label: `Page ${i + 1}: ${plain(q.label.text, 40)}` })
    }
  })
  for (const q of Object.values(def.questions)) {
    if (q.type === 'hidden' && q.settings.param) options.push({ value: `{{hidden:${q.settings.param}}}`, label: `Hidden field: ${q.settings.param}` })
    if (q.type === 'calculated' && !def.pages.some((p) => p.question_ids.includes(q.id)) && !(scored.has(q.id) && pageIndex !== null)) {
      options.push({ value: `{{calc:${q.question_key}}}`, label: `Calculation: ${plain(q.label.text, 40)}` })
    }
  }
  return (
    <Select
      label={label}
      hint="Adds a token that shows the answer when the survey runs."
      options={options}
      placeholder={options.length ? 'Choose an answer to insert' : 'Nothing to insert yet'}
      value=""
      disabled={disabled || options.length === 0}
      onChange={(e) => {
        if (e.target.value) onInsert(e.target.value)
      }}
    />
  )
}
