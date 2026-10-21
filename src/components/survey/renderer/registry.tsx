/**
 * Type registry (doc 03 section 5): one entry per QuestionType with its Input,
 * default settings for the builder palette, the empty value, and a summary
 * formatter for the ending screen. Shared with Phase 2B.
 *
 * Decision: `page_break` is not a QuestionType in the 1B schema; pages are the
 * structure (Page.question_ids), so PageView handles breaks and the registry
 * has no entry for them.
 */

import {
  choiceIds,
  formatCalc,
  otherText,
  type AnswerValue,
  type ChoiceOption,
  type FileRef,
  type QuestionType,
} from '@/lib/survey'
import type { TypeRegistry } from './types'
import { AddressInput } from './inputs/AddressInput'
import { CalculatedDisplay, HiddenField, ImageBlock, StatementBlock } from './inputs/BlockInputs'
import { DropdownInput, MultipleChoiceInput, SingleChoiceInput, YesNoInput } from './inputs/ChoiceInputs'
import { ConsentInput } from './inputs/ConsentInput'
import { DateInput, formatDate, TimeInput } from './inputs/DateTimeInputs'
import { FileUploadInput } from './inputs/FileUploadInput'
import { MatrixInput } from './inputs/MatrixInput'
import { RankingInput } from './inputs/RankingInput'
import { NpsInput, RatingInput } from './inputs/ScaleInputs'
import { SignatureInput } from './inputs/SignatureInput'
import { EmailInput, LongTextInput, NumberInput, PhoneInput, ShortTextInput } from './inputs/TextInputs'

const text = (_q: unknown, v: AnswerValue) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

function optionLabels(options: ChoiceOption[], v: AnswerValue): string {
  const other = otherText(v)
  return choiceIds(v)
    .map((id) => {
      const o = options.find((x) => x.id === id)
      if (!o) return id
      return o.is_other && other ? `${o.label}: ${other}` : o.label
    })
    .join(', ')
}

export const registry: TypeRegistry = {
  short_text: { Input: ShortTextInput, defaultSettings: {}, emptyValue: '', summarize: text, frame: 'fieldset' },
  long_text: { Input: LongTextInput, defaultSettings: { rows: 4 }, emptyValue: '', summarize: text, frame: 'fieldset' },
  email: { Input: EmailInput, defaultSettings: {}, emptyValue: '', summarize: text, frame: 'fieldset' },
  phone: { Input: PhoneInput, defaultSettings: { default_country: 'US' }, emptyValue: '', summarize: text, frame: 'fieldset' },
  number: {
    Input: NumberInput,
    defaultSettings: {},
    emptyValue: '',
    summarize: (q, v) => `${q.settings.prefix ?? ''}${typeof v === 'number' ? v : ''}${q.settings.suffix ?? ''}`,
    frame: 'fieldset',
  },
  single_choice: {
    Input: SingleChoiceInput,
    defaultSettings: { options: [], randomize: false, layout: 'list' },
    emptyValue: undefined,
    summarize: (q, v) => optionLabels(q.settings.options, v),
    frame: 'fieldset',
  },
  multiple_choice: {
    Input: MultipleChoiceInput,
    defaultSettings: { options: [], randomize: false },
    emptyValue: [],
    summarize: (q, v) => optionLabels(q.settings.options, v),
    frame: 'fieldset',
  },
  dropdown: {
    Input: DropdownInput,
    defaultSettings: { options: [], randomize: false, searchable: true },
    emptyValue: undefined,
    summarize: (q, v) => optionLabels(q.settings.options, v),
    frame: 'fieldset',
  },
  yes_no: {
    Input: YesNoInput,
    defaultSettings: { yes_label: 'Yes', no_label: 'No' },
    emptyValue: undefined,
    summarize: (q, v) => (v === 1 ? q.settings.yes_label : q.settings.no_label),
    frame: 'fieldset',
  },
  rating: {
    Input: RatingInput,
    defaultSettings: { points: 5, display: 'stars' },
    emptyValue: undefined,
    summarize: (q, v) => `${typeof v === 'number' ? v : ''} of ${q.settings.points}`,
    frame: 'fieldset',
  },
  nps: { Input: NpsInput, defaultSettings: {}, emptyValue: undefined, summarize: text, frame: 'fieldset' },
  matrix: {
    Input: MatrixInput,
    defaultSettings: { rows: [], columns: [], randomize_rows: false, all_rows_required: false },
    emptyValue: {},
    summarize: (q, v) => {
      const m = v as Record<string, string>
      return q.settings.rows
        .filter((r) => m[r.id])
        .map((r) => `${r.label}: ${q.settings.columns.find((c) => c.id === m[r.id])?.label ?? ''}`)
        .join('; ')
    },
    frame: 'fieldset',
  },
  ranking: {
    Input: RankingInput,
    defaultSettings: { options: [], randomize: true },
    emptyValue: [],
    summarize: (q, v) =>
      choiceIds(v)
        .map((id, i) => `${i + 1}. ${q.settings.options.find((o) => o.id === id)?.label ?? id}`)
        .join(', '),
    frame: 'fieldset',
  },
  date: {
    Input: DateInput,
    defaultSettings: { display_format: 'MDY' },
    emptyValue: '',
    summarize: (q, v) => (typeof v === 'string' ? formatDate(v, q.settings.display_format) : ''),
    frame: 'fieldset',
  },
  time: { Input: TimeInput, defaultSettings: { minute_step: 15 }, emptyValue: '', summarize: text, frame: 'fieldset' },
  file_upload: {
    Input: FileUploadInput,
    defaultSettings: {},
    emptyValue: [],
    // File answers show file names only (doc 02 section 10).
    summarize: (_q, v) => (Array.isArray(v) ? (v as FileRef[]).map((f) => f.name).join(', ') : ''),
    frame: 'fieldset',
  },
  signature: {
    Input: SignatureInput,
    defaultSettings: { pen_color: '#000000' },
    emptyValue: undefined,
    summarize: (_q, v) => (v && typeof v === 'object' && 'name' in v ? String((v as FileRef).name) : ''),
    frame: 'fieldset',
  },
  address: {
    Input: AddressInput,
    defaultSettings: { parts_required: { line1: true, city: true, postal: true } },
    emptyValue: {},
    summarize: (_q, v) => {
      const a = v as Record<string, string>
      return ['line1', 'line2', 'city', 'region', 'postal', 'country']
        .map((p) => a[p])
        .filter(Boolean)
        .join(', ')
    },
    frame: 'fieldset',
  },
  consent: {
    Input: ConsentInput,
    defaultSettings: { text_source: 'workspace', gates_tracking: false },
    emptyValue: undefined,
    summarize: (_q, v) => (v === 1 ? 'Agreed' : 'Not agreed'),
    frame: 'fieldset',
  },
  hidden: { Input: HiddenField, defaultSettings: { param: '' }, emptyValue: undefined, frame: 'none' },
  calculated: {
    Input: CalculatedDisplay,
    defaultSettings: { formula: { num: 0 }, formula_source: '0', visible: false },
    emptyValue: undefined,
    summarize: (q, v) => (typeof v === 'number' ? formatCalc(q, v) : ''),
    frame: 'block',
  },
  statement: { Input: StatementBlock, defaultSettings: { body: { format: 'md-lite', text: '' } }, emptyValue: undefined, frame: 'block' },
  image: { Input: ImageBlock, defaultSettings: { path: '', alt: '', width: 'full' }, emptyValue: undefined, frame: 'block' },
}

/** Types that hold an answer the respondent gives. */
export function isAnswerable(type: QuestionType): boolean {
  return type !== 'statement' && type !== 'image' && type !== 'hidden' && type !== 'calculated'
}
