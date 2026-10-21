/**
 * Builder vocabulary on top of the renderer registry: palette groups, type
 * labels, and new-question factories. Client and test safe.
 */

import {
  STORAGE_COLUMN,
  type ContactFieldTarget,
  type Question,
  type QuestionType,
  type SurveyDefinition,
} from '@/lib/survey'
import { registry } from '@/components/survey/renderer'
import { newChildId, newId } from '@/lib/builder/ops'
import { rich } from '@/lib/builder/defaults'

export const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  dropdown: 'Dropdown',
  yes_no: 'Yes or no',
  rating: 'Rating',
  nps: 'Net Promoter Score',
  matrix: 'Matrix (Likert)',
  ranking: 'Ranking',
  date: 'Date',
  time: 'Time',
  file_upload: 'File upload',
  signature: 'Signature',
  address: 'Address',
  consent: 'Consent',
  hidden: 'Hidden field',
  calculated: 'Calculation',
  statement: 'Text block',
  image: 'Image',
}

/** Doc 03 section 6 palette groups. Decision: number sits with Text, consent with Contact. */
export const PALETTE_GROUPS: { label: string; types: QuestionType[] }[] = [
  { label: 'Text', types: ['short_text', 'long_text', 'number'] },
  { label: 'Choice', types: ['single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'ranking'] },
  { label: 'Scale', types: ['rating', 'nps', 'matrix'] },
  { label: 'Date and time', types: ['date', 'time'] },
  { label: 'Upload', types: ['file_upload', 'signature'] },
  { label: 'Contact', types: ['email', 'phone', 'address', 'consent'] },
  { label: 'Layout', types: ['statement', 'image'] },
  { label: 'Advanced', types: ['hidden', 'calculated'] },
]

/** Every registry type appears in exactly one group (tested). */
export const PALETTE_TYPES: QuestionType[] = (Object.keys(registry) as QuestionType[]).filter((t) =>
  PALETTE_GROUPS.some((g) => g.types.includes(t)),
)

export const DISPLAY_TYPES: ReadonlySet<QuestionType> = new Set(['statement', 'image'])
export const NO_REQUIRED_TYPES: ReadonlySet<QuestionType> = new Set(['statement', 'image', 'hidden', 'calculated'])
export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(['single_choice', 'multiple_choice', 'dropdown', 'ranking'])

/** contact_field compatibility, same set as lint (doc 03 section 2). */
export const CONTACT_FIELD_TYPES: ReadonlySet<QuestionType> = new Set(['short_text', 'phone', 'email', 'number', 'date', 'single_choice', 'dropdown', 'yes_no'])

export const CORE_CONTACT_FIELDS: { value: string; label: string; target: ContactFieldTarget }[] = [
  { value: 'core:first_name', label: 'First name', target: { kind: 'core', field: 'first_name' } },
  { value: 'core:last_name', label: 'Last name', target: { kind: 'core', field: 'last_name' } },
  { value: 'core:company', label: 'Company', target: { kind: 'core', field: 'company' } },
  { value: 'core:phone', label: 'Phone', target: { kind: 'core', field: 'phone' } },
]

export function contactFieldValue(t: ContactFieldTarget | undefined): string {
  if (!t) return ''
  return t.kind === 'core' ? `core:${t.field}` : `custom:${t.key}`
}

export function contactFieldTarget(value: string): ContactFieldTarget | undefined {
  if (value.startsWith('core:')) return CORE_CONTACT_FIELDS.find((f) => f.value === value)?.target
  if (value.startsWith('custom:')) return { kind: 'custom', key: value.slice(7) }
  return undefined
}

const DEFAULT_LABELS: Partial<Record<QuestionType, string>> = {
  statement: 'Text block',
  image: 'Image',
  hidden: 'Hidden field',
  calculated: 'Calculation',
  consent: 'Consent',
}

/** Type settings for a fresh question: registry defaults plus starter options, rows and columns. */
export function defaultSettings(type: QuestionType, def: SurveyDefinition): unknown {
  const base = structuredClone(registry[type].defaultSettings) as Record<string, unknown>
  if (CHOICE_TYPES.has(type)) {
    const a = newChildId('option', [])
    const b = newChildId('option', [{ id: a }])
    base.options = [
      { id: a, label: 'Option 1' },
      { id: b, label: 'Option 2' },
    ]
  }
  if (type === 'matrix') {
    const r1 = newChildId('row', [])
    const r2 = newChildId('row', [{ id: r1 }])
    const cols: { id: string; label: string }[] = []
    for (const label of ['Disagree', 'Neutral', 'Agree']) cols.push({ id: newChildId('column', cols), label })
    base.rows = [
      { id: r1, label: 'Row 1' },
      { id: r2, label: 'Row 2' },
    ]
    base.columns = cols
  }
  if (type === 'hidden') {
    const used = new Set(Object.values(def.questions).flatMap((q) => (q.type === 'hidden' ? [q.settings.param] : [])))
    let n = 1
    while (used.has(`param${n}`)) n++
    base.param = `param${n}`
  }
  if (type === 'image') base.alt = 'Image'
  if (type === 'statement') base.body = rich('Write your text here.')
  return base
}

export function newQuestion(type: QuestionType, def: SurveyDefinition, label?: string): Question {
  const id = newId(def, 'question')
  return {
    id,
    question_key: id,
    type,
    label: rich(label ?? DEFAULT_LABELS[type] ?? 'Untitled question'),
    required: false,
    settings: defaultSettings(type, def),
    ...(type === 'address' || type === 'signature' ? { pii: true } : {}),
  } as Question
}

export const sameStorage = (a: QuestionType, b: QuestionType) => STORAGE_COLUMN[a] === STORAGE_COLUMN[b]

export function plain(text: string | undefined, max = 80): string {
  const t = (text ?? '').replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}...` : t
}
