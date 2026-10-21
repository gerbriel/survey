import type { AnswerLite, QuestionSnapshot } from '../types'

export const V1 = '11111111-1111-4111-8111-111111111111'
export const V2 = '22222222-2222-4222-8222-222222222222'

let n = 0
export function ans(p: Partial<AnswerLite> & { question_key?: string }): AnswerLite {
  n++
  return {
    response_id: p.response_id ?? `r${n}`,
    question_key: p.question_key ?? 'q_aaaaaaaa',
    survey_version_id: p.survey_version_id ?? V1,
    value_text: p.value_text ?? null,
    value_number: p.value_number ?? null,
    value_date: p.value_date ?? null,
    value_json: p.value_json ?? null,
  }
}

export function q(p: Partial<QuestionSnapshot> & { type: string }): QuestionSnapshot {
  return {
    survey_version_id: p.survey_version_id ?? V1,
    question_key: p.question_key ?? 'q_aaaaaaaa',
    type: p.type,
    label: p.label ?? 'Question',
    position: p.position ?? 0,
    page_index: p.page_index ?? 0,
    is_pii: p.is_pii ?? false,
    options: p.options ?? null,
    settings: p.settings ?? {},
  }
}

export const OPTS = [
  { id: 'opt_a', label: 'Alpha' },
  { id: 'opt_b', label: 'Beta' },
  { id: 'opt_c', label: 'Gamma' },
]
