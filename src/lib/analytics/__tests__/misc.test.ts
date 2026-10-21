import { describe, expect, it } from 'vitest'
import { analyze, orderedQuestions, widgetCrossTab } from '../analyze'
import { crossTab } from '../crosstab'
import { DEFAULT_FILTERS, filtersFromReport, filtersToQuery, hasNonEventFilter, parseFilters, reportFiltersFrom, toResponseFilters } from '../filters'
import { formatCount, suppressCount } from '../suppress'
import { compareQuestion, compareVersions } from '../versions'
import { chartsForType, defaultWidgets } from '../widgets'
import { ans, OPTS, q, V1, V2 } from './fixtures'

describe('small cell suppression', () => {
  it('counts under 3 become "<3"', () => {
    expect(suppressCount(0)).toBe('<3')
    expect(suppressCount(2)).toBe('<3')
    expect(suppressCount(3)).toBe(3)
    expect(suppressCount(null)).toBe('<3')
    expect(suppressCount(50, true)).toBe('<3')
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount('<3')).toBe('<3')
  })
})

describe('cross-tab', () => {
  it('counts and column percent', () => {
    const cols = [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }]
    const rowA = [ans({ response_id: 'r1', value_text: 'opt_a' }), ans({ response_id: 'r2', value_text: 'opt_b' }), ans({ response_id: 'r3', value_text: 'opt_a' }), ans({ response_id: 'r4', value_text: 'opt_a' })]
    const colA = [ans({ response_id: 'r1', value_text: 'y' }), ans({ response_id: 'r2', value_text: 'y' }), ans({ response_id: 'r3', value_text: 'n' })]
    const t = crossTab(OPTS, rowA, cols, colA)
    expect(t.n).toBe(3)
    expect(t.counts).toEqual([[1, 1], [1, 0], [0, 0]])
    expect(t.columnTotals).toEqual([2, 1])
    expect(t.columnPct[0]).toEqual([50, 100])
  })
})

describe('cross-version comparison', () => {
  const v1 = { versionId: V1, versionNo: 1, questions: [q({ type: 'single_choice', options: OPTS.slice(0, 2), survey_version_id: V1 })] }
  const v2 = { versionId: V2, versionNo: 2, questions: [q({ type: 'single_choice', options: OPTS, survey_version_id: V2 })] }
  it('reports added options and their base', () => {
    const d = compareQuestion('q_aaaaaaaa', [v2, v1])!
    expect(d.typeChanged).toBe(false)
    expect(d.messages[0]).toBe("Options changed between v1 and v2: 'Gamma' added in v2.")
    expect(d.offeredBy).toEqual({ opt_c: [V2] })
    expect(d.options.map((o) => o.id)).toEqual(['opt_a', 'opt_b', 'opt_c'])
  })
  it('flags type changes and ignores identical snapshots', () => {
    const v3 = { versionId: 'v3', versionNo: 3, questions: [q({ type: 'multiple_choice', options: OPTS })] }
    expect(compareQuestion('q_aaaaaaaa', [v2, v3])!.typeChanged).toBe(true)
    expect(compareVersions([v2, { ...v2, versionId: 'x', versionNo: 5 }]).size).toBe(0)
  })
  it('analyze refuses to combine a changed type and applies the base', () => {
    const r = analyze({
      versions: [v1, v2],
      scopeVersionIds: [V1, V2],
      funnelVersionId: V2,
      responses: [],
      answers: [ans({ value_text: 'opt_c', survey_version_id: V2 }), ans({ value_text: 'opt_a', survey_version_id: V1 })],
      events: [],
      filters: { ...DEFAULT_FILTERS, version: 'all' },
      window: { from: null, to: null },
    })
    const b = r.blocks[0]!
    expect(b.diff).not.toBeNull()
    expect(b.summary?.kind === 'choice' && b.summary.options.find((o) => o.id === 'opt_c')!.pct).toBe(100)
    expect(r.notes[0]).toContain('latest version (v2)')
  })
  it('orderedQuestions: latest first, older-only keys appended, display types skipped', () => {
    const a = { versionId: V1, versionNo: 1, questions: [q({ type: 'number', question_key: 'q_old00000' }), q({ type: 'statement', question_key: 'q_stmt0000' })] }
    const b = { versionId: V2, versionNo: 2, questions: [q({ type: 'nps', question_key: 'q_new00000' })] }
    expect(orderedQuestions([a, b], [V1, V2]).map((x) => x.question_key)).toEqual(['q_new00000', 'q_old00000'])
  })
  it('widgetCrossTab refuses non-choice questions', () => {
    const v = { versionId: V1, versionNo: 1, questions: [q({ type: 'nps', question_key: 'q_a0000000' }), q({ type: 'single_choice', question_key: 'q_b0000000', options: OPTS })] }
    expect(widgetCrossTab([v], [V1], [], 'q_a0000000', 'q_b0000000')).toBeNull()
  })
})

describe('filters', () => {
  it('parses, drops junk and round trips', () => {
    const f = parseFilters(new URLSearchParams('range=custom&from=2026-01-01&to=2026-01-31&version=all&identity=token&status=all&lead=new,bogus&lead=lost&tags=vip&aq=q_abcdefgh&av=opt_a,opt_b&xt=q_12345678&owner=nope'))
    expect(f).toMatchObject({ range: 'custom', from: '2026-01-01', to: '2026-01-31', version: 'all', identity: 'token', status: 'all', lead: ['new', 'lost'], tags: ['vip'], owners: [], crossTab: 'q_12345678' })
    expect(f.answer).toEqual({ question_key: 'q_abcdefgh', any_of: ['opt_a', 'opt_b'] })
    expect(parseFilters(new URLSearchParams(filtersToQuery(f)))).toEqual(f)
    expect(parseFilters({ range: 'weird', version: 'x' })).toEqual(DEFAULT_FILTERS)
  })
  it('builds filtered_responses jsonb with an exclusive end date', () => {
    const f = parseFilters({ range: 'custom', from: '2026-01-01', to: '2026-01-31', lead: 'qualified' })
    expect(toResponseFilters(f)).toEqual({
      version: 'latest',
      status: 'complete',
      identity: 'all',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      contact: { lead_status: ['qualified'] },
    })
    const rel = toResponseFilters(parseFilters({ range: '7d' }), new Date('2026-10-21T00:00:00Z'))
    expect(rel.from).toBe('2026-10-14T00:00:00.000Z')
  })
  it('event metrics flag non-event filters', () => {
    expect(hasNonEventFilter(parseFilters({ range: '7d', version: 'all' }))).toBe(false)
    expect(hasNonEventFilter(parseFilters({ identity: 'anonymous' }))).toBe(true)
  })
  it('report filters keep SQL shape plus the UI form', () => {
    const f = parseFilters({ range: '30d', status: 'all' })
    const stored = reportFiltersFrom(f, new Date('2026-10-21T00:00:00Z'))
    expect(stored).toMatchObject({ status: 'all', from: '2026-09-21T00:00:00.000Z', ui: { range: '30d', status: 'all' } })
    expect(filtersFromReport(stored)).toEqual(f)
    expect(filtersFromReport(null)).toEqual(DEFAULT_FILTERS)
  })
})

describe('default report', () => {
  it('completion, over time, then one widget per question with its default chart', () => {
    const w = defaultWidgets([q({ type: 'nps', question_key: 'q_b0000000', position: 1 }), q({ type: 'single_choice', question_key: 'q_a0000000', position: 0 }), q({ type: 'statement', question_key: 'q_s0000000', position: 2 }), q({ type: 'hidden', question_key: 'q_h0000000', position: 3 })])
    expect(w.map((x) => x.metric ?? x.question_key)).toEqual(['completion', 'responses_over_time', 'q_a0000000', 'q_b0000000'])
    expect(w.map((x) => x.chart_type)).toEqual(['stat', 'line', 'bar', 'nps_gauge'])
    expect(w.map((x) => x.position)).toEqual([0, 1, 2, 3])
    expect(chartsForType('matrix')[0]).toBe('heat_table')
  })
})
