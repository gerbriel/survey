import { describe, expect, it } from 'vitest'
import { checkDefinitionShape, DefinitionShapeError, migrateDefinition, safeMigrateDefinition } from '../migrate'
import { ALL_TYPES, BRANCHING, PIPING, QUIZ } from './fixtures'

describe('migrateDefinition', () => {
  it('accepts every fixture unchanged and does not mutate input', () => {
    for (const d of [ALL_TYPES, BRANCHING, QUIZ, PIPING]) {
      const before = JSON.stringify(d)
      const out = migrateDefinition(d)
      expect(out).toEqual(d)
      expect(out).not.toBe(d)
      expect(JSON.stringify(d)).toBe(before)
    }
  })

  it('fills missing collections with defaults', () => {
    const raw = JSON.parse(JSON.stringify(PIPING))
    delete raw.logic
    delete raw.identity
    delete raw.pixel_exclusions
    const out = migrateDefinition(raw)
    expect(out.logic).toEqual([])
    expect(out.identity).toEqual({})
    expect(out.pixel_exclusions).toEqual([])
  })

  it('rejects non-objects, bad versions, and newer versions', () => {
    expect(() => migrateDefinition(null)).toThrow(DefinitionShapeError)
    expect(() => migrateDefinition([])).toThrow(/expected object/)
    expect(() => migrateDefinition({ ...PIPING, schema_version: 0 })).toThrow(/positive integer/)
    expect(() => migrateDefinition({ ...PIPING, schema_version: '1' })).toThrow(/positive integer/)
    expect(() => migrateDefinition({ ...PIPING, schema_version: 2 })).toThrow(/newer/)
  })

  it('reports every shape problem with a path', () => {
    const bad = JSON.parse(JSON.stringify(ALL_TYPES))
    bad.settings.title = 5
    bad.questions.q_shorttxt.type = 'video'
    bad.questions.q_singlech.settings.options = 'nope'
    bad.questions.q_ratingxx.settings.points = 20
    bad.questions.q_calcxxxx.settings.formula = { fn: 'eval' }
    bad.questions.q_matrixxx.id = 'q_other000'
    bad.logic = [{ id: 'l_x', kind: 'teleport', when: { field: { kind: 'question', id: 'x' }, op: 'like' } }]
    bad.endings = [{ id: 'e_1' }]
    bad.pages = [5]
    const r = safeMigrateDefinition(bad)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const joined = r.issues.join('\n')
    for (const frag of ['settings.title', 'questions.q_shorttxt.type', 'settings.options', 'settings.points', 'settings.formula', 'questions.q_matrixxx.id', 'logic[0].kind', 'logic[0].when.op', 'endings[0].message', 'pages[0]']) {
      expect(joined).toContain(frag)
    }
    try {
      migrateDefinition(bad)
    } catch (e) {
      expect(e).toBeInstanceOf(DefinitionShapeError)
      expect((e as Error).message).toMatch(/more\)/)
    }
  })

  it('checks per-type settings and rule shapes', () => {
    const bad = JSON.parse(JSON.stringify(ALL_TYPES))
    bad.questions.q_yesnoxxx.settings = {}
    bad.questions.q_timexxxx.settings = { minute_step: 0 }
    bad.questions.q_phonenum.settings = {}
    bad.questions.q_datexxxx.settings = { display_format: 'X' }
    bad.questions.q_address1.settings = {}
    bad.questions.q_consentx.settings = { text_source: 'x' }
    bad.questions.q_hiddenxx.settings = { param: '' }
    bad.questions.q_statemnt.settings = {}
    bad.questions.q_imagexxx.settings = {}
    bad.questions.q_matrixxx.settings = { rows: [{}], columns: 'x' }
    bad.questions.q_longtext.label = 'plain'
    bad.questions.q_longtext.help = 'plain'
    bad.questions.q_longtext.validation = 'x'
    bad.questions.q_longtext.required = 'yes'
    bad.questions.q_singlech.settings.options = [5, { id: 1, label: 'x', score: 'high' }]
    bad.questions.q_calcxxxx.settings = {
      formula: { op: '%', args: [{ num: 'x' }, { ref: { kind: 'bad', id: 'x' } }, { fn: 'round', arg: { num: 1 } }, { fn: 'if', cond: { not: { field: { kind: 'hidden' }, op: 'eq' } }, then: { num: 1 }, else: { fn: 'score', ids: [1] } }] },
    }
    bad.settings.quiz = { score_calc_id: 5 }
    bad.settings.randomize_pages = {}
    bad.pages[0].randomize_questions = {}
    bad.pages[0].description = 'x'
    bad.logic = [
      { id: 'l1', kind: 'show_question', when: { any: 'x' } },
      { id: 'l2', kind: 'jump', when: { all: [] }, to: {} },
      { id: 'l3', kind: 'set_ending', when: { all: [] } },
      { id: 'l4', kind: 'show_page', target_id: 'p', when: { field: { kind: 'weird' }, op: 'eq' } },
      { id: 'l5', kind: 'hide_question', target_id: 'q', when: { field: 5, op: 'eq' } },
      5,
    ]
    bad.endings = [5, { id: 'e', message: { format: 'md-lite', text: '' }, show_score: true, show_summary: true, redirect_url: 5 }]
    bad.closed_message = 'x'
    bad.identity = null
    bad.pixel_exclusions = [1]
    bad.theme = null
    const issues = checkDefinitionShape(bad)
    expect(issues.length).toBeGreaterThan(30)
    expect(checkDefinitionShape(5)).toEqual(['$: expected object'])
    const notObjQ = JSON.parse(JSON.stringify(PIPING))
    notObjQ.questions.q_namexxxx = 5
    notObjQ.questions.q_qtyxxxxx.settings = null
    notObjQ.questions = { ...notObjQ.questions }
    expect(checkDefinitionShape(notObjQ).length).toBe(2)
    expect(checkDefinitionShape({ ...PIPING, questions: [] }).join()).toContain('questions')
  })

  it('caps expression and condition depth', () => {
    let e: unknown = { num: 1 }
    for (let i = 0; i < 70; i++) e = { op: '+', args: [e] }
    let c: unknown = { field: { kind: 'hidden', param: 'x' }, op: 'is_answered' }
    for (let i = 0; i < 70; i++) c = { not: c }
    const bad = JSON.parse(JSON.stringify(PIPING))
    bad.questions.q_totalxxx.settings.formula = e
    bad.logic = [{ id: 'l', kind: 'show_page', target_id: 'p', when: c }]
    const issues = checkDefinitionShape(bad).join('\n')
    expect(issues).toContain('expression too deep')
    expect(issues).toContain('condition too deep')
  })
})

describe('L5 theme colors', () => {
  const withColor = (primary: unknown) => ({ ...PIPING, theme: { ...PIPING.theme, colors: { ...PIPING.theme.colors, primary } } })

  it('accepts #rgb and #rrggbb in either case', () => {
    for (const c of ['#abc', '#A1B2C3', '#000000']) expect(checkDefinitionShape(withColor(c))).toEqual([])
  })

  it('rejects CSS declaration injection and anything that is not a short or long hex color', () => {
    for (const c of ['#000;background-image:url(https://tracker.example/p)', 'red', 'rgb(0,0,0)', '#abcd', '#12345g', '', 7]) {
      expect(checkDefinitionShape(withColor(c))).toContain('theme.colors.primary: expected #rgb or #rrggbb')
      expect(() => migrateDefinition(withColor(c))).toThrow(DefinitionShapeError)
    }
  })
})
