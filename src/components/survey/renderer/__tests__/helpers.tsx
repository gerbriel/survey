/* Shared test helpers for renderer tests. Not a test file itself. */

import { useState } from 'react'
import { evaluate, splitDefinition, type Question, type SurveyDefinition, type ValidationError } from '@/lib/survey'
import { NOW } from '@/lib/survey/__tests__/fixtures'
import { QuestionBlock } from '../QuestionFrame'
import { DEFAULT_STRINGS } from '../strings'
import type { InputContext } from '../types'

export const SEED = 'test-seed'

export function publicHalf(def: SurveyDefinition): SurveyDefinition {
  return splitDefinition(def).public_definition
}

export function makeCtx(def: SurveyDefinition, answers: Record<string, unknown> = {}, extra: Partial<InputContext> = {}): InputContext {
  return {
    definition: def,
    state: evaluate(def, answers, { now: NOW, hidden: {}, seed: SEED }),
    seed: SEED,
    mode: 'preview',
    now: NOW,
    strings: DEFAULT_STRINGS,
    ...extra,
  }
}

/** Controlled harness: holds the value in state and reports every change. */
export function Harness({
  question,
  def,
  initial,
  errors = [],
  onValue,
}: {
  question: Question
  def: SurveyDefinition
  initial?: unknown
  errors?: ValidationError[]
  onValue?: (v: unknown) => void
}) {
  const [value, setValue] = useState<unknown>(initial)
  return (
    <QuestionBlock
      question={question}
      value={value}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
      errors={errors}
      ctx={makeCtx(def, { [question.question_key]: value })}
    />
  )
}
