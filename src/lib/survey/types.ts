/**
 * Survey definition types. Source: docs/03-builder-and-logic.md sections 2 to 4
 * and section 8 (Theme). Pure types plus two const tables, no runtime imports.
 *
 * Wire format note: answers travel keyed by `question_key` (doc 02 section 5,
 * doc 01 submit_response). Logic, pages and identity reference question `id`.
 * New questions get `id === question_key`; they can only diverge when a type
 * change across storage columns forces a fresh key (doc 03 section 7).
 */

export const CURRENT_SCHEMA_VERSION = 1 as const

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'yes_no',
  'rating',
  'nps',
  'matrix',
  'ranking',
  'date',
  'time',
  'file_upload',
  'signature',
  'address',
  'consent',
  'hidden',
  'calculated',
  'statement',
  'image',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

/** Types that render but never hold an answer. */
export const DISPLAY_ONLY_TYPES = ['statement', 'image'] as const satisfies readonly QuestionType[]

export type StorageColumn = 'value_text' | 'value_number' | 'value_date' | 'value_json' | 'none'

/** Primary storage column per type (doc 03 section 1). Drives toAnswerRow and diff classification. */
export const STORAGE_COLUMN: Record<QuestionType, StorageColumn> = {
  short_text: 'value_text',
  long_text: 'value_text',
  email: 'value_text',
  phone: 'value_text',
  number: 'value_number',
  single_choice: 'value_text',
  multiple_choice: 'value_json',
  dropdown: 'value_text',
  yes_no: 'value_number',
  rating: 'value_number',
  nps: 'value_number',
  matrix: 'value_json',
  ranking: 'value_json',
  date: 'value_date',
  time: 'value_text',
  file_upload: 'value_json',
  signature: 'value_json',
  address: 'value_json',
  consent: 'value_number',
  hidden: 'value_text',
  calculated: 'value_number',
  statement: 'none',
  image: 'none',
}

export type RichText = { format: 'md-lite'; text: string }

export type SafeFont =
  | 'Inter'
  | 'Roboto'
  | 'Open Sans'
  | 'Lato'
  | 'Source Serif 4'
  | 'Merriweather'
  | 'Poppins'
  | 'Work Sans'
  | 'IBM Plex Sans'
  | 'system-ui'

/**
 * Where a survey header (cover) image comes from (doc 03 section 8.1):
 * a starter shipped with the app at /headers/{id}.svg, an image from the
 * workspace library, or a one-off upload. Workspace and upload carry the
 * object name inside public-assets; the public page never reads the library
 * table (anon has no table grants), so the path travels with the theme.
 */
export type CoverSource =
  | { kind: 'starter'; id: string }
  | { kind: 'workspace'; image_id: string; path: string }
  | { kind: 'upload'; path: string }

export interface CoverImage {
  source: CoverSource
  height: 'short' | 'tall'
  /** 0..1 */
  focal_y: number
}

/** The shape before the image library: a bare Storage path. migrateDefinition reads it as source upload. */
export interface LegacyCoverImage {
  path: string
  height: 'short' | 'tall'
  focal_y: number
}

export interface Theme {
  colors: {
    primary: string
    text: string
    muted_text: string
    background: string
    surface: string
    error: string
  }
  font: { heading: SafeFont; body: SafeFont; base_size: 'sm' | 'md' | 'lg' }
  logo: { source: 'workspace' | 'none' | 'custom'; custom_path?: string; position: 'left' | 'center'; size: 'sm' | 'md' | 'lg' }
  cover_image?: CoverImage
  background: { kind: 'color' } | { kind: 'image'; path: string; overlay_opacity: number }
  button_text: { next: string; back: string; submit: string; start?: string }
  progress: { style: 'bar' | 'steps' | 'percent' | 'none'; position: 'top' | 'bottom' }
  corner_radius: 'none' | 'sm' | 'md' | 'lg'
  layout: 'card' | 'full'
}

export interface SurveySettings {
  title: string
  description?: RichText
  show_progress: boolean
  show_question_numbers: boolean
  allow_back: boolean
  one_question_per_screen: boolean
  randomize_pages?: { page_ids: string[] }
  autosave_partial: boolean
  quiz?: { score_calc_id: string; show_correct_answers: boolean }
  trust_hidden_identity: boolean
}

export interface Page {
  id: string
  title?: string
  description?: RichText
  question_ids: string[]
  randomize_questions?: { pinned_ids: string[] }
  button_label?: string
}

export type ContactFieldTarget =
  | { kind: 'core'; field: 'first_name' | 'last_name' | 'company' | 'phone' }
  | { kind: 'custom'; key: string }

export interface ChoiceOption {
  id: string
  label: string
  export_value?: string
  image_path?: string
  /** Server only (doc 03 section 2.1). */
  score?: number
  is_other?: boolean
  is_exclusive?: boolean
  pin_last?: boolean
}

export interface Validation {
  min_length?: number
  max_length?: number
  pattern?: { regex: string; flags?: 'i'; message: string }
  min?: number
  max?: number
  integer?: boolean
  min_date?: string | { relative_days: number }
  max_date?: string | { relative_days: number }
  min_selections?: number
  max_selections?: number
  allowed_extensions?: string[]
  max_file_mb?: number
  max_files?: number
  allowed_email_domains?: string[]
  blocked_email_domains?: string[]
}

export interface QuestionBase<T extends QuestionType, S> {
  id: string
  /** `^q_[a-z0-9]{8}$` (doc 01 section 4), unique within the survey, stable across versions. */
  question_key: string
  type: T
  label: RichText
  help?: RichText
  required: boolean
  validation?: Validation
  contact_field?: ContactFieldTarget
  pii?: boolean
  settings: S
}

export interface MatrixRow {
  id: string
  label: string
}
export interface MatrixColumn {
  id: string
  label: string
  /** Server only. */
  score?: number
}

export type AddressPart = 'line1' | 'line2' | 'city' | 'region' | 'postal' | 'country'
export const ADDRESS_PARTS: readonly AddressPart[] = ['line1', 'line2', 'city', 'region', 'postal', 'country']

export type ShortTextQuestion = QuestionBase<'short_text', { placeholder?: string; mask?: string }>
export type LongTextQuestion = QuestionBase<'long_text', { placeholder?: string; rows?: number }>
export type EmailQuestion = QuestionBase<'email', { placeholder?: string; confirm?: boolean }>
export type PhoneQuestion = QuestionBase<'phone', { default_country: string }>
export type NumberQuestion = QuestionBase<'number', { decimals?: number; prefix?: string; suffix?: string }>
export type SingleChoiceSettings = {
  options: ChoiceOption[]
  randomize: boolean
  layout?: 'list' | 'columns'
  searchable?: boolean
  /** Server only. */
  correct_option_id?: string
}
export type SingleChoiceQuestion = QuestionBase<'single_choice' | 'dropdown', SingleChoiceSettings>
export type MultipleChoiceQuestion = QuestionBase<
  'multiple_choice',
  { options: ChoiceOption[]; randomize: boolean; /** Server only. */ correct_option_ids?: string[] }
>
export type YesNoQuestion = QuestionBase<
  'yes_no',
  { yes_label: string; no_label: string; /** Server only. */ yes_score?: number; /** Server only. */ no_score?: number }
>
export type RatingQuestion = QuestionBase<
  'rating',
  { points: number; display: 'stars' | 'numbers' | 'emoji' | 'slider'; min_label?: string; max_label?: string }
>
export type NpsQuestion = QuestionBase<'nps', { min_label?: string; max_label?: string }>
export type MatrixQuestion = QuestionBase<
  'matrix',
  { rows: MatrixRow[]; columns: MatrixColumn[]; randomize_rows: boolean; all_rows_required: boolean }
>
export type RankingQuestion = QuestionBase<'ranking', { options: ChoiceOption[]; randomize: boolean; rank_top_n?: number }>
export type DateQuestion = QuestionBase<'date', { display_format: 'MDY' | 'DMY' | 'YMD'; disabled_weekdays?: number[] }>
export type TimeQuestion = QuestionBase<'time', { minute_step: number }>
export type FileUploadQuestion = QuestionBase<'file_upload', Record<string, never>>
export type SignatureQuestion = QuestionBase<'signature', { pen_color?: string }>
export type AddressQuestion = QuestionBase<
  'address',
  { parts_required: Partial<Record<AddressPart, boolean>>; default_country?: string; lock_country?: boolean }
>
export type ConsentQuestion = QuestionBase<
  'consent',
  { text_source: 'workspace' | 'custom'; custom_text?: RichText; gates_tracking: boolean }
>
export type HiddenQuestion = QuestionBase<'hidden', { param: string; default_value?: string }>
export type CalculatedQuestion = QuestionBase<
  'calculated',
  { formula: Expr; formula_source: string; visible: boolean; decimals?: number }
>
export type StatementQuestion = QuestionBase<'statement', { body: RichText }>
export type ImageQuestion = QuestionBase<'image', { path: string; alt: string; width: 'small' | 'medium' | 'full'; href?: string }>

export type Question =
  | ShortTextQuestion
  | LongTextQuestion
  | EmailQuestion
  | PhoneQuestion
  | NumberQuestion
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | YesNoQuestion
  | RatingQuestion
  | NpsQuestion
  | MatrixQuestion
  | RankingQuestion
  | DateQuestion
  | TimeQuestion
  | FileUploadQuestion
  | SignatureQuestion
  | AddressQuestion
  | ConsentQuestion
  | HiddenQuestion
  | CalculatedQuestion
  | StatementQuestion
  | ImageQuestion

/** Narrow a Question by its type tag. */
export type QuestionOf<T extends QuestionType> = Question extends infer Q
  ? Q extends { type: infer U }
    ? T extends U
      ? Q & { type: T }
      : never
    : never
  : never

export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion | RankingQuestion

export interface Ending {
  id: string
  title?: RichText
  message: RichText
  redirect_url?: string
  redirect_delay_seconds?: number
  redirect_pass_params?: boolean
  show_score: boolean
  show_summary: boolean
}

export interface IdentityKeys {
  email_question_id?: string
  phone_question_id?: string
}

export interface SurveyDefinition {
  schema_version: typeof CURRENT_SCHEMA_VERSION
  settings: SurveySettings
  theme: Theme
  pages: Page[]
  questions: Record<string, Question>
  logic: LogicRule[]
  endings: Ending[]
  closed_message: RichText
  identity: IdentityKeys
  pixel_exclusions: string[]
}

// ---------------------------------------------------------------- logic

export type Operand = string | number | boolean | string[] | null

export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches',
  'is_answered',
  'is_not_answered',
  'includes_any',
  'includes_all',
  'includes_none',
  'before',
  'after',
  'on',
] as const
export type Operator = (typeof OPERATORS)[number]

export type LeafField =
  | { kind: 'question'; id: string; row_id?: string }
  | { kind: 'hidden'; param: string }
  | { kind: 'calc'; id: string }

export interface Leaf {
  field: LeafField
  op: Operator
  value?: Operand
}

export type Condition = Leaf | { all: Condition[] } | { any: Condition[] } | { not: Condition }

export type LogicRule =
  | { id: string; kind: 'show_question'; target_id: string; when: Condition }
  | { id: string; kind: 'hide_question'; target_id: string; when: Condition }
  | { id: string; kind: 'show_page'; target_id: string; when: Condition }
  | { id: string; kind: 'jump'; from_page_id: string; to: { page_id: string } | { ending_id: string }; when: Condition; order: number }
  | { id: string; kind: 'set_ending'; ending_id: string; when: Condition; order: number }

export type LogicRuleKind = LogicRule['kind']

export type Expr =
  | { num: number }
  | { ref: { kind: 'question' | 'hidden' | 'calc'; id: string } }
  | { op: '+' | '-' | '*' | '/' | 'min' | 'max'; args: Expr[] }
  | { fn: 'score'; ids: string[] }
  | { fn: 'correct'; ids: string[] }
  | { fn: 'round'; arg: Expr; places: number }
  | { fn: 'if'; cond: Condition; then: Expr; else: Expr }

// ---------------------------------------------------------------- answers

export interface FileRef {
  path: string
  name: string
  size: number
  mime: string
}

export type AddressValue = Partial<Record<AddressPart, string>>

/**
 * Normalized answer, shaped like its storage column (doc 03 section 4).
 * Booleans (yes_no, consent) are 1 or 0. Choice answers with "Other" text use
 * the object forms.
 */
export type AnswerValue =
  | string
  | number
  | string[]
  | { id: string; other: string }
  | { ids: string[]; other: string }
  | Record<string, string>
  | FileRef
  | FileRef[]
  | AddressValue

export interface ServerOnly {
  option_scores: Record<string, Record<string, number>>
  correct: Record<string, string | string[]>
  yes_no_scores: Record<string, { yes?: number; no?: number }>
  matrix_column_scores: Record<string, Record<string, number>>
  scored_calcs: Record<string, Question>
  scored_rules: LogicRule[]
}
