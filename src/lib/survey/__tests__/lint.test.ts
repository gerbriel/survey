import { describe, expect, it } from 'vitest'
import { calcCycles, diffDefinitions, lintDefinition, MAX_QUESTIONS } from '../lint'
import type { Question, QuestionOf, SurveyDefinition } from '../types'
import { ALL_TYPES, BRANCHING, defn, ending, PIPING, q, QUIZ, rt } from './fixtures'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const lintCodes = (d: SurveyDefinition, opts = {}) => lintDefinition(d, opts).issues.map((i) => i.code)
const errorsOf = (d: SurveyDefinition, opts = {}) => lintDefinition(d, opts).issues.filter((i) => i.severity === 'error').map((i) => i.code)

describe('lintDefinition', () => {
  it('passes every fixture', () => {
    for (const d of [ALL_TYPES, BRANCHING, QUIZ, PIPING]) {
      const r = lintDefinition(d)
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(r.ok).toBe(true)
    }
  })

  it('caps: question count and size', () => {
    const many = defn({ questions: Array.from({ length: 301 }, (_, i) => q({ id: `q_${String(i).padStart(8, '0')}`, type: 'short_text', settings: {} })) })
    expect(errorsOf(many)).toContain('question_cap')
    expect(errorsOf(many, { maxQuestions: 400 })).not.toContain('question_cap')
    expect(MAX_QUESTIONS).toBe(300)
    const big = clone(PIPING)
    big.settings.title = 'x'.repeat(1024 * 1024)
    expect(errorsOf(big)).toContain('size_cap')
    expect(errorsOf(PIPING, { maxDefinitionBytes: 100 })).toContain('size_cap')
  })

  it('keys: format, duplicates, collisions, id mismatch', () => {
    const d = clone(PIPING)
    ;(d.questions.q_namexxxx as Question).question_key = 'first_name'
    ;(d.questions.q_qtyxxxxx as Question).question_key = 'q_colorxxx'
    ;(d.questions.q_colorxxx as Question).question_key = 'q_colorxxx'
    ;(d.questions.q_pricehid as Question).id = 'q_other000'
    const c = errorsOf(d)
    expect(c).toEqual(expect.arrayContaining(['question_key_format', 'question_key_duplicate', 'question_id_mismatch']))
    const e = clone(PIPING)
    ;(e.questions.q_namexxxx as Question).question_key = 'q_qtyxxxxx'
    ;(e.questions.q_qtyxxxxx as Question).question_key = 'q_newkey01'
    expect(errorsOf(e)).toContain('question_key_collides_with_id')
  })

  it('options: empty, duplicate ids, empty labels, format warning', () => {
    const d = clone(ALL_TYPES)
    const s = d.questions.q_singlech as QuestionOf<'single_choice'>
    s.settings.options[1]!.id = 'o_red00001'
    s.settings.options[2]!.label = ' '
    ;(d.questions.q_dropdown as QuestionOf<'dropdown'>).settings.options = []
    ;(d.questions.q_multich1 as QuestionOf<'multiple_choice'>).settings.options[0]!.id = 'bad'
    const m = d.questions.q_matrixxx as QuestionOf<'matrix'>
    m.settings.rows[1]!.id = 'r_speed001'
    const r = lintDefinition(d)
    const c = r.issues.map((i) => `${i.severity}:${i.code}`)
    expect(c).toEqual(expect.arrayContaining(['error:option_id_duplicate', 'error:option_label_empty', 'error:options_empty', 'warning:option_id_format']))
    const empty = clone(ALL_TYPES)
    ;(empty.questions.q_matrixxx as QuestionOf<'matrix'>).settings.columns = []
    expect(errorsOf(empty)).toContain('options_empty')
  })

  it('pages: duplicate ids, unknown questions, many pages, orphans', () => {
    const d = clone(BRANCHING)
    d.pages.push({ id: 'p_start001', question_ids: ['q_nothere1', 'q_rolexxxx'] })
    d.pages[3]!.question_ids = []
    expect(errorsOf(d)).toEqual(expect.arrayContaining(['page_id_duplicate', 'page_unknown_question', 'question_on_many_pages', 'question_orphan']))
  })

  it('identity must point at email and phone questions', () => {
    const d = clone(ALL_TYPES)
    d.identity = { email_question_id: 'q_shorttxt', phone_question_id: 'q_nothere1' }
    expect(errorsOf(d).filter((c) => c === 'identity_type')).toHaveLength(2)
  })

  it('endings: at least one, unique, redirect http(s)', () => {
    const d = clone(PIPING)
    d.endings = []
    expect(errorsOf(d)).toContain('endings_empty')
    d.endings = [ending('e_1'), ending('e_1', { redirect_url: 'javascript:alert(1)' }), ending('e_2', { redirect_url: 'https://' }), ending('e_3', { redirect_url: 'https://ok.org/?a={{q:q_namexxxx}}' })]
    const c = errorsOf(d)
    expect(c.filter((x) => x === 'redirect_url')).toHaveLength(2)
    expect(c).toContain('ending_id_duplicate')
  })

  it('logic: refs, operators, depth, backward jumps, duplicates, matrix rows, regex', () => {
    const d = clone(BRANCHING)
    const L = (x: unknown) => x as SurveyDefinition['logic'][number]
    d.logic = [
      L({ id: 'l_1', kind: 'show_question', target_id: 'q_nothere1', when: { field: { kind: 'question', id: 'q_nothere1' }, op: 'eq', value: 1 } }),
      L({ id: 'l_1', kind: 'hide_question', target_id: 'q_agexxxxx', when: { field: { kind: 'question', id: 'q_agexxxxx' }, op: 'contains', value: 'x' } }),
      L({ id: 'l_3', kind: 'show_page', target_id: 'p_nothere1', when: { all: [{ any: [{ not: { all: [] } }] }] } }),
      L({ id: 'l_4', kind: 'jump', from_page_id: 'p_final001', to: { page_id: 'p_start001' }, when: { all: [] }, order: 1 }),
      L({ id: 'l_5', kind: 'jump', from_page_id: 'p_nothere1', to: { page_id: 'p_nothere2' }, when: { all: [] }, order: 1 }),
      L({ id: 'l_6', kind: 'jump', from_page_id: 'p_start001', to: { ending_id: 'e_nothere1' }, when: { field: { kind: 'calc', id: 'q_rolexxxx' }, op: 'eq' }, order: 1 }),
      L({ id: 'l_7', kind: 'set_ending', ending_id: 'e_nothere1', when: { field: { kind: 'question', id: 'q_schoolxx' }, op: 'matches', value: '(a+)+' }, order: 1 }),
      L({ id: 'l_8', kind: 'set_ending', ending_id: 'e_default1', when: { field: { kind: 'question', id: 'q_rolexxxx', row_id: 'r_x' }, op: 'is_answered' }, order: 2 }),
      L({ id: 'l_9', kind: 'set_ending', ending_id: 'e_default1', when: { field: { kind: 'hidden', param: 'x' }, op: 'starts_with', value: 'a' }, order: 3 }),
    ]
    const c = errorsOf(d)
    expect(c.filter((x) => x === 'logic_ref').length).toBeGreaterThanOrEqual(6)
    expect(c).toEqual(expect.arrayContaining(['rule_id_duplicate', 'logic_operator', 'logic_depth', 'jump_backward', 'regex_invalid']))
    expect(lintDefinition(d).ok).toBe(false)
  })

  it('warns on jumps involving randomized pages', () => {
    const d = clone(BRANCHING)
    d.settings.randomize_pages = { page_ids: ['p_student1', 'p_teacher1'] }
    expect(lintCodes(d)).toContain('randomized_page_jump')
  })

  it('calcs: missing refs, cycles, bad if conditions', () => {
    const cq = (id: string, formula: unknown) => q({ id, type: 'calculated', settings: { formula, formula_source: '', visible: true } } as never)
    const d = defn({
      questions: [
        cq('q_cyc00001', { ref: { kind: 'calc', id: 'q_cyc00002' } }),
        cq('q_cyc00002', { op: '+', args: [{ ref: { kind: 'question', id: 'q_cyc00001' } }] }),
        cq('q_badref01', { op: '+', args: [{ ref: { kind: 'question', id: 'q_nothere1' } }, { ref: { kind: 'calc', id: 'q_nothere2' } }, { fn: 'round', arg: { fn: 'if', cond: { field: { kind: 'question', id: 'q_nothere3' }, op: 'eq' }, then: { num: 1 }, else: { num: 0 } }, places: 0 }] }),
      ],
    })
    const c = errorsOf(d)
    expect(c.filter((x) => x === 'calc_cycle')).toHaveLength(2)
    expect(c.filter((x) => x === 'calc_ref')).toHaveLength(3)
    expect(c).toContain('logic_ref')
    expect(calcCycles(d)).toEqual(['q_cyc00001', 'q_cyc00002'])
  })

  it('scored calcs: must be hidden, only set_ending and endings may use them, quiz calc must be a calc', () => {
    const d = clone(QUIZ)
    ;(d.questions.q_scorexxx as QuestionOf<'calculated'>).settings.visible = true
    d.logic.push({ id: 'l_bad00001', kind: 'show_question', target_id: 'q_plaincal', when: { field: { kind: 'question', id: 'q_scorexxx' }, op: 'gt', value: 1 } })
    ;(d.questions.q_quizyn01 as Question).label = rt('Your score so far {{calc:q_scorexxx}}')
    d.settings.quiz = { score_calc_id: 'q_quiz0001', show_correct_answers: false }
    const c = errorsOf(d)
    expect(c).toEqual(expect.arrayContaining(['scored_calc_visible', 'scored_calc_use', 'quiz_calc']))
    expect(c.filter((x) => x === 'scored_calc_use')).toHaveLength(2)
  })

  it('piping: missing refs, later pages, not pipeable, calc kind', () => {
    const d = clone(PIPING)
    ;(d.questions.q_namexxxx as Question).label = rt('Hello {{q:q_qtyxxxxx}} {{q:q_nothere1}} {{calc:q_namexxxx}} {{hidden:any}}')
    d.questions.q_filexxxx = q({ id: 'q_filexxxx', type: 'file_upload', settings: {} })
    d.pages[0]!.question_ids.push('q_filexxxx')
    d.pages[1]!.title = 'About {{q:q_filexxxx}}'
    d.pages[1]!.description = rt('{{q:q_summary1}}')
    d.settings.description = rt('{{q:q_namexxxx}}')
    d.closed_message = rt('{{q:q_namexxxx}}')
    const opts = (d.questions.q_colorxxx as QuestionOf<'multiple_choice'>).settings.options
    opts[0]!.label = 'Red like {{q:q_colorxxx}}'
    d.endings[0]!.title = rt('{{q:q_filexxxx}}')
    const c = errorsOf(d)
    expect(c.filter((x) => x === 'pipe_ref')).toHaveLength(2)
    expect(c).toEqual(expect.arrayContaining(['pipe_later', 'pipe_not_pipeable']))
    // Endings may pipe any question; hidden/calc may pipe anywhere.
    const ok = clone(PIPING)
    ;(ok.questions.q_namexxxx as Question).help = rt('{{calc:q_totalxxx}} {{q:q_pricehid}}')
    expect(errorsOf(ok)).toEqual([])
  })

  it('regex in validation', () => {
    const d = defn({ questions: [q({ id: 'q_pattern1', type: 'short_text', settings: {}, validation: { pattern: { regex: '(\\w+)*$', message: 'x' } } })] })
    expect(errorsOf(d)).toEqual(['regex_invalid'])
  })

  it('contact_field type compatibility and existence', () => {
    const d = clone(ALL_TYPES)
    ;(d.questions.q_shorttxt as Question).contact_field = { kind: 'core', field: 'first_name' }
    ;(d.questions.q_phonenum as Question).contact_field = { kind: 'core', field: 'phone' }
    ;(d.questions.q_numberxx as Question).contact_field = { kind: 'custom', key: 'age' }
    expect(errorsOf(d, { contactFieldKeys: ['age'] })).toEqual([])
    expect(errorsOf(d, { contactFieldKeys: [] })).toEqual(['contact_field_missing'])
    ;(d.questions.q_emailadr as Question).contact_field = { kind: 'core', field: 'company' }
    ;(d.questions.q_matrixxx as Question).contact_field = { kind: 'custom', key: 'age' }
    ;(d.questions.q_numberxx as Question).contact_field = { kind: 'core', field: 'phone' }
    ;(d.questions.q_dropdown as Question).contact_field = { kind: 'core', field: 'last_name' }
    expect(errorsOf(d).filter((x) => x === 'contact_field_type')).toHaveLength(4)
  })

  it('warns when in_form consent mode has no tracking consent block', () => {
    expect(lintCodes(PIPING, { pixelConsentMode: 'in_form', loadsPixels: true })).toEqual(['consent_tracking_missing'])
    expect(lintDefinition(PIPING, { pixelConsentMode: 'in_form', loadsPixels: true }).ok).toBe(true)
    expect(lintCodes(ALL_TYPES, { pixelConsentMode: 'in_form', loadsPixels: true })).not.toContain('consent_tracking_missing')
    expect(lintCodes(PIPING, { pixelConsentMode: 'banner', loadsPixels: true })).toEqual([])
  })

})

describe('diffDefinitions', () => {
  const kinds = (a: SurveyDefinition, b: SurveyDefinition) => diffDefinitions(a, b).changes.map((c) => `${c.class}:${c.kind}`)

  it('no changes', () => {
    const r = diffDefinitions(ALL_TYPES, clone(ALL_TYPES))
    expect(r.changes).toEqual([])
    expect(r.has_breaking).toBe(false)
  })

  it('safe changes: wording, options added and relabeled, required, validation, settings, reorder, theme, endings', () => {
    const b = clone(ALL_TYPES)
    ;(b.questions.q_shorttxt as Question).label = rt('New label')
    ;(b.questions.q_shorttxt as Question).required = true
    ;(b.questions.q_shorttxt as Question).validation = { max_length: 5 }
    ;(b.questions.q_shorttxt as QuestionOf<'short_text'>).settings.placeholder = 'x'
    const s = b.questions.q_singlech as QuestionOf<'single_choice'>
    s.settings.options[0]!.label = 'Crimson'
    s.settings.options.push({ id: 'o_new00001', label: 'New' })
    b.pages[0]!.question_ids.reverse()
    b.theme.corner_radius = 'lg'
    b.endings[0]!.message = rt('Bye')
    b.closed_message = rt('Shut')
    b.settings.title = 'New'
    b.questions.q_added001 = q({ id: 'q_added001', type: 'short_text', settings: {} })
    const r = diffDefinitions(ALL_TYPES, b)
    expect(r.has_breaking).toBe(false)
    expect(kinds(ALL_TYPES, b).sort()).toEqual(
      [
        'safe:label_changed',
        'safe:required_changed',
        'safe:validation_changed',
        'safe:settings_changed',
        'safe:option_relabeled',
        'safe:option_added',
        'safe:reordered',
        'safe:theme_changed',
        'safe:endings_changed',
        'safe:closed_message_changed',
        'safe:settings_survey_changed',
        'safe:question_added',
      ].sort(),
    )
  })

  it('logic changes are noted', () => {
    const b = clone(BRANCHING)
    b.logic.pop()
    expect(kinds(BRANCHING, b)).toEqual(['noted:logic_changed'])
  })

  it('breaking changes', () => {
    const b = clone(ALL_TYPES)
    ;(b.questions.q_singlech as QuestionOf<'single_choice'>).settings.options.pop()
    const m = b.questions.q_matrixxx as QuestionOf<'matrix'>
    m.settings.rows.pop()
    m.settings.columns.pop()
    ;(b.questions.q_ratingxx as QuestionOf<'rating'>).settings.points = 10
    delete b.questions.q_longtext
    b.pages[0]!.question_ids = b.pages[0]!.question_ids.filter((x) => x !== 'q_longtext')
    ;(b.questions.q_shorttxt as Question).question_key = 'q_renamed1'
    b.questions.q_numberxx = { ...(b.questions.q_numberxx as Question), type: 'short_text', settings: {} } as Question
    b.questions.q_dropdown = { ...(b.questions.q_dropdown as Question), type: 'short_text', settings: {} } as Question
    const r = diffDefinitions(ALL_TYPES, b)
    expect(r.has_breaking).toBe(true)
    expect(r.breaking.map((c) => c.kind).sort()).toEqual(
      ['option_removed', 'matrix_row_removed', 'matrix_column_removed', 'rating_scale_changed', 'question_removed', 'question_key_changed', 'type_changed_storage', 'option_removed'].sort(),
    )
    expect(r.breaking.find((c) => c.kind === 'question_key_changed')?.question_key).toBe('q_renamed1')
    expect(r.safe.map((c) => c.kind)).toContain('type_changed_same_storage')
    expect(r.noted).toEqual([])
  })
})
