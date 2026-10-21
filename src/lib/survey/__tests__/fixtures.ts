/* Fixture definitions for the survey core tests. Not a test file itself. */

import type { Condition, Ending, Expr, Question, RichText, SurveyDefinition, Theme } from '../types'

export const rt = (text: string): RichText => ({ format: 'md-lite', text })

export const THEME: Theme = {
  colors: { primary: '#2255ff', text: '#111111', muted_text: '#555555', background: '#ffffff', surface: '#f5f5f5', error: '#cc0000' },
  font: { heading: 'Inter', body: 'Inter', base_size: 'md' },
  logo: { source: 'workspace', position: 'left', size: 'md' },
  background: { kind: 'color' },
  button_text: { next: 'Next', back: 'Back', submit: 'Submit' },
  progress: { style: 'bar', position: 'top' },
  corner_radius: 'md',
  layout: 'card',
}

export function ending(id: string, extra: Partial<Ending> = {}): Ending {
  return { id, message: rt(`Thanks from ${id}`), show_score: false, show_summary: false, ...extra }
}

type QIn = Omit<Question, 'question_key' | 'label' | 'required'> & { question_key?: string; label?: RichText; required?: boolean }

/** Build a question with id === question_key unless overridden. */
export function q(input: QIn): Question {
  return { question_key: input.id, label: rt(`Label ${input.id}`), required: false, ...input } as Question
}

export function defn(parts: Omit<Partial<SurveyDefinition>, 'questions'> & { questions: Question[] }): SurveyDefinition {
  const { questions, ...rest } = parts
  return {
    schema_version: 1,
    settings: {
      title: 'Fixture',
      show_progress: true,
      show_question_numbers: false,
      allow_back: true,
      one_question_per_screen: false,
      autosave_partial: true,
      trust_hidden_identity: false,
    },
    theme: THEME,
    pages: [{ id: 'p_page0001', question_ids: questions.map((x) => x.id) }],
    logic: [],
    endings: [ending('e_default1')],
    closed_message: rt('Closed'),
    identity: {},
    pixel_exclusions: [],
    ...rest,
    questions: Object.fromEntries(questions.map((x) => [x.id, x])),
  }
}

const opt = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, ...extra })

// ------------------------------------------------------------ every type

export const ALL_TYPES_QUESTIONS: Question[] = [
  q({ id: 'q_shorttxt', type: 'short_text', settings: { placeholder: 'Name' }, validation: { min_length: 2, max_length: 20 } }),
  q({ id: 'q_longtext', type: 'long_text', settings: { rows: 4 }, validation: { max_length: 50 } }),
  q({ id: 'q_emailadr', type: 'email', settings: { confirm: true }, validation: { blocked_email_domains: ['spam.test'] } }),
  q({ id: 'q_phonenum', type: 'phone', settings: { default_country: 'US' } }),
  q({ id: 'q_numberxx', type: 'number', settings: { decimals: 0 }, validation: { min: 0, max: 100, integer: true } }),
  q({
    id: 'q_singlech',
    type: 'single_choice',
    settings: { options: [opt('o_red00001', 'Red'), opt('o_blue0001', 'Blue'), opt('o_other001', 'Other', { is_other: true })], randomize: true },
  }),
  q({
    id: 'q_multich1',
    type: 'multiple_choice',
    settings: {
      options: [opt('o_aaaaaaaa', 'A'), opt('o_bbbbbbbb', 'B'), opt('o_cccccccc', 'C'), opt('o_none0001', 'None', { is_exclusive: true })],
      randomize: true,
    },
    validation: { min_selections: 1, max_selections: 2 },
  }),
  q({ id: 'q_dropdown', type: 'dropdown', settings: { options: [opt('o_ca000001', 'California'), opt('o_ny000001', 'New York')], randomize: false, searchable: true } }),
  q({ id: 'q_yesnoxxx', type: 'yes_no', settings: { yes_label: 'Yes', no_label: 'No' } }),
  q({ id: 'q_ratingxx', type: 'rating', settings: { points: 5, display: 'stars' } }),
  q({ id: 'q_npsxxxxx', type: 'nps', settings: {} }),
  q({
    id: 'q_matrixxx',
    type: 'matrix',
    settings: {
      rows: [
        { id: 'r_speed001', label: 'Speed' },
        { id: 'r_price001', label: 'Price' },
      ],
      columns: [
        { id: 'c_bad00001', label: 'Bad' },
        { id: 'c_good0001', label: 'Good' },
      ],
      randomize_rows: true,
      all_rows_required: true,
    },
  }),
  q({
    id: 'q_rankingx',
    type: 'ranking',
    settings: { options: [opt('o_rank0001', 'One'), opt('o_rank0002', 'Two'), opt('o_rank0003', 'Three')], randomize: true, rank_top_n: 2 },
  }),
  q({
    id: 'q_datexxxx',
    type: 'date',
    settings: { display_format: 'YMD', disabled_weekdays: [0] },
    validation: { min_date: { relative_days: 0 }, max_date: '2027-12-31' },
  }),
  q({ id: 'q_timexxxx', type: 'time', settings: { minute_step: 15 }, validation: { min: 540, max: 1020 } }),
  q({ id: 'q_filesxxx', type: 'file_upload', settings: {}, validation: { allowed_extensions: ['pdf', 'png'], max_file_mb: 1, max_files: 2 } }),
  q({ id: 'q_signatur', type: 'signature', settings: { pen_color: '#000000' } }),
  q({ id: 'q_address1', type: 'address', settings: { parts_required: { line1: true, city: true }, default_country: 'US', lock_country: true }, pii: true }),
  q({ id: 'q_consentx', type: 'consent', settings: { text_source: 'custom', custom_text: rt('I agree'), gates_tracking: true }, required: true }),
  q({ id: 'q_hiddenxx', type: 'hidden', settings: { param: 'source', default_value: 'direct' } }),
  q({ id: 'q_calcxxxx', type: 'calculated', settings: { formula: { op: '*', args: [{ ref: { kind: 'question', id: 'q_numberxx' } }, { num: 2 }] }, formula_source: '{{q:q_numberxx}} * 2', visible: true } }),
  q({ id: 'q_statemnt', type: 'statement', settings: { body: rt('Hello {{q:q_shorttxt|friend}}') } }),
  q({ id: 'q_imagexxx', type: 'image', settings: { path: 'ws/img.png', alt: 'An image', width: 'full' } }),
]

export const ALL_TYPES: SurveyDefinition = defn({
  questions: ALL_TYPES_QUESTIONS,
  pages: [
    { id: 'p_text0001', question_ids: ['q_shorttxt', 'q_longtext', 'q_emailadr', 'q_phonenum', 'q_numberxx', 'q_hiddenxx'] },
    { id: 'p_choice01', question_ids: ['q_singlech', 'q_multich1', 'q_dropdown', 'q_yesnoxxx', 'q_ratingxx', 'q_npsxxxxx', 'q_matrixxx', 'q_rankingx'], randomize_questions: { pinned_ids: ['q_rankingx'] } },
    { id: 'p_misc0001', question_ids: ['q_datexxxx', 'q_timexxxx', 'q_filesxxx', 'q_signatur', 'q_address1', 'q_consentx', 'q_calcxxxx', 'q_statemnt', 'q_imagexxx'] },
  ],
  identity: { email_question_id: 'q_emailadr', phone_question_id: 'q_phonenum' },
})

export const NOW = '2026-10-21T12:00:00Z'
export const PDF = { path: 'resp/1/a.pdf', name: 'a.pdf', size: 1000, mime: 'application/pdf' }
export const PNG = { path: 'resp/1/sig.png', name: 'sig.png', size: 500, mime: 'image/png' }

/** A complete valid answer set for ALL_TYPES, keyed by question_key. */
export const ALL_TYPES_ANSWERS: Record<string, unknown> = {
  q_shorttxt: '  Ada  ',
  q_longtext: 'Some text',
  q_emailadr: { email: 'Ada@Example.com', confirm: 'ada@example.com' },
  q_phonenum: '(555) 123-4567',
  q_numberxx: '42',
  q_singlech: { id: 'o_other001', other: 'Green' },
  q_multich1: ['o_aaaaaaaa', 'o_bbbbbbbb'],
  q_dropdown: 'o_ca000001',
  q_yesnoxxx: true,
  q_ratingxx: 4,
  q_npsxxxxx: 9,
  q_matrixxx: { r_speed001: 'c_good0001', r_price001: 'c_bad00001' },
  q_rankingx: ['o_rank0002', 'o_rank0001'],
  q_datexxxx: '2026-10-22',
  q_timexxxx: '09:30',
  q_filesxxx: [PDF],
  q_signatur: PNG,
  q_address1: { line1: '1 Main St', city: 'Fresno', country: 'US' },
  q_consentx: true,
  q_calcxxxx: 9999,
}

export const ALL_TYPES_FILES = { q_filesxxx: [PDF], q_signatur: [PNG] }

// ------------------------------------------------------------ branching

const roleIs = (id: string): Condition => ({ field: { kind: 'question', id: 'q_rolexxxx' }, op: 'eq', value: id })

export const BRANCHING: SurveyDefinition = defn({
  questions: [
    q({
      id: 'q_rolexxxx',
      type: 'single_choice',
      required: true,
      settings: { options: [opt('o_student1', 'Student'), opt('o_teacher1', 'Teacher'), opt('o_visitor1', 'Visitor')], randomize: false },
    }),
    q({ id: 'q_agexxxxx', type: 'number', settings: {} }),
    q({ id: 'q_schoolxx', type: 'short_text', required: true, settings: {} }),
    q({ id: 'q_gradexxx', type: 'short_text', settings: {} }),
    q({ id: 'q_studentq', type: 'short_text', required: true, settings: {} }),
    q({ id: 'q_teachrq1', type: 'short_text', required: true, settings: {} }),
    q({ id: 'q_finalxxx', type: 'long_text', required: true, settings: {} }),
  ],
  pages: [
    { id: 'p_start001', question_ids: ['q_rolexxxx', 'q_agexxxxx', 'q_schoolxx', 'q_gradexxx'] },
    { id: 'p_student1', question_ids: ['q_studentq'] },
    { id: 'p_teacher1', question_ids: ['q_teachrq1'] },
    { id: 'p_final001', question_ids: ['q_finalxxx'] },
  ],
  logic: [
    { id: 'l_showschl', kind: 'show_question', target_id: 'q_schoolxx', when: roleIs('o_student1') },
    { id: 'l_hidegrad', kind: 'hide_question', target_id: 'q_gradexxx', when: { field: { kind: 'question', id: 'q_agexxxxx' }, op: 'gt', value: 30 } },
    { id: 'l_jumpvis1', kind: 'jump', from_page_id: 'p_start001', to: { ending_id: 'e_visitor1' }, when: roleIs('o_visitor1'), order: 1 },
    { id: 'l_jumptch1', kind: 'jump', from_page_id: 'p_start001', to: { page_id: 'p_teacher1' }, when: roleIs('o_teacher1'), order: 2 },
    { id: 'l_jumpstu1', kind: 'jump', from_page_id: 'p_student1', to: { page_id: 'p_final001' }, when: { all: [] }, order: 1 },
    { id: 'l_showtch1', kind: 'show_page', target_id: 'p_teacher1', when: roleIs('o_teacher1') },
  ],
  endings: [ending('e_default1'), ending('e_visitor1')],
})

// ------------------------------------------------------------ quiz

const scoreExpr: Expr = {
  op: '+',
  args: [{ fn: 'score', ids: ['q_quiz0001', 'q_quiz0002', 'q_quizyn01', 'q_quizmtx1'] }, { fn: 'correct', ids: ['q_quiz0001', 'q_quiz0002'] }],
}

export const QUIZ: SurveyDefinition = defn({
  settings: {
    title: 'Quiz',
    show_progress: true,
    show_question_numbers: true,
    allow_back: true,
    one_question_per_screen: false,
    autosave_partial: true,
    trust_hidden_identity: false,
    quiz: { score_calc_id: 'q_scorexxx', show_correct_answers: true },
  },
  questions: [
    q({
      id: 'q_quiz0001',
      type: 'single_choice',
      required: true,
      settings: { options: [opt('o_q1right1', 'Paris', { score: 2 }), opt('o_q1wrong1', 'Rome', { score: 0 })], randomize: false, correct_option_id: 'o_q1right1' },
    }),
    q({
      id: 'q_quiz0002',
      type: 'multiple_choice',
      settings: {
        options: [opt('o_q2a00001', '2', { score: 1 }), opt('o_q2b00001', '3', { score: 1 }), opt('o_q2c00001', '4', { score: -1 })],
        randomize: false,
        correct_option_ids: ['o_q2a00001', 'o_q2b00001'],
      },
    }),
    q({ id: 'q_quizyn01', type: 'yes_no', settings: { yes_label: 'True', no_label: 'False', yes_score: 1, no_score: 0 } }),
    q({
      id: 'q_quizmtx1',
      type: 'matrix',
      settings: {
        rows: [{ id: 'r_mrow0001', label: 'Row' }],
        columns: [
          { id: 'c_mcol0001', label: 'Low', score: 0 },
          { id: 'c_mcol0002', label: 'High', score: 3 },
        ],
        randomize_rows: false,
        all_rows_required: false,
      },
    }),
    q({ id: 'q_scorexxx', type: 'calculated', settings: { formula: scoreExpr, formula_source: 'score(...) + correct(...)', visible: false } }),
    // Scored through another calc (transitive).
    q({ id: 'q_pctxxxxx', type: 'calculated', settings: { formula: { fn: 'round', arg: { op: '*', args: [{ ref: { kind: 'calc', id: 'q_scorexxx' } }, { num: 10 }] }, places: 0 }, formula_source: 'x', visible: false } }),
    q({ id: 'q_plaincal', type: 'calculated', settings: { formula: { num: 7 }, formula_source: '7', visible: true } }),
  ],
  pages: [
    { id: 'p_quiz0001', question_ids: ['q_quiz0001', 'q_quiz0002'] },
    { id: 'p_quiz0002', question_ids: ['q_quizyn01', 'q_quizmtx1', 'q_scorexxx', 'q_pctxxxxx', 'q_plaincal'] },
  ],
  logic: [
    { id: 'l_passxxxx', kind: 'set_ending', ending_id: 'e_pass0001', when: { field: { kind: 'calc', id: 'q_scorexxx' }, op: 'gte', value: 6 }, order: 1 },
    { id: 'l_plainxxx', kind: 'set_ending', ending_id: 'e_seven001', when: { field: { kind: 'calc', id: 'q_plaincal' }, op: 'eq', value: 8 }, order: 2 },
  ],
  endings: [ending('e_fail0001', { show_score: true }), ending('e_pass0001', { show_score: true, message: rt('You scored {{calc:q_scorexxx}}') }), ending('e_seven001')],
})

// ------------------------------------------------------------ piping and calc

export const PIPING: SurveyDefinition = defn({
  questions: [
    q({ id: 'q_namexxxx', type: 'short_text', required: true, settings: {} }),
    q({ id: 'q_qtyxxxxx', type: 'number', settings: {} }),
    q({ id: 'q_colorxxx', type: 'multiple_choice', settings: { options: [opt('o_red00001', 'Red'), opt('o_blue0001', 'Blue')], randomize: false } }),
    q({ id: 'q_pricehid', type: 'hidden', settings: { param: 'price', default_value: '10' } }),
    q({
      id: 'q_totalxxx',
      type: 'calculated',
      settings: { formula: { op: '*', args: [{ ref: { kind: 'question', id: 'q_qtyxxxxx' } }, { ref: { kind: 'hidden', id: 'price' } }] }, formula_source: '{{q:q_qtyxxxxx}} * {{hidden:price}}', visible: true, decimals: 2 },
    }),
    q({ id: 'q_summary1', type: 'statement', label: rt('Hi {{q:q_namexxxx}}'), settings: { body: rt('Hi {{q:q_namexxxx|there}}, you like {{q:q_colorxxx}}. Total {{calc:q_totalxxx}} via {{hidden:utm_source|none}}') } }),
  ],
  pages: [
    { id: 'p_pipe0001', question_ids: ['q_namexxxx', 'q_qtyxxxxx', 'q_colorxxx'] },
    { id: 'p_pipe0002', question_ids: ['q_summary1', 'q_totalxxx'] },
  ],
  endings: [ending('e_default1', { redirect_url: 'https://example.org/thanks?name={{q:q_namexxxx}}&total={{calc:q_totalxxx}}' })],
})
