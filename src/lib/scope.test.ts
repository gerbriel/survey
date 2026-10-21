import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireMember: vi.fn() }))
vi.mock('@/lib/db/contacts', () => ({ getContact: vi.fn() }))
vi.mock('@/lib/db/reports', () => ({ getReport: vi.fn() }))
vi.mock('@/lib/db/responses', () => ({ getResponse: vi.fn() }))
vi.mock('@/lib/db/surveys', () => ({ getSurvey: vi.fn() }))
const { belongsTo } = await import('./scope')

const WS = 'w1'
const S = 's1'

describe('D-15 belongsTo', () => {
  it('accepts rows in the slug workspace and survey', () => {
    expect(
      belongsTo(WS, { surveyId: S, responseId: 'r', reportId: 'p' }, {
        survey: { id: S, workspace_id: WS },
        response: { workspace_id: WS, survey_id: S },
        report: { workspace_id: WS, survey_id: S },
      }),
    ).toBe(true)
    expect(belongsTo(WS, { contactId: 'c' }, { contact: { workspace_id: WS } })).toBe(true)
  })

  it('rejects a wrong-workspace or wrong-survey id', () => {
    expect(belongsTo(WS, { surveyId: S }, { survey: { id: S, workspace_id: 'other' } })).toBe(false)
    expect(belongsTo(WS, { surveyId: S, responseId: 'r' }, { survey: { id: S, workspace_id: WS }, response: { workspace_id: WS, survey_id: 'other' } })).toBe(false)
    expect(belongsTo(WS, { responseId: 'r' }, { response: { workspace_id: 'other', survey_id: S } })).toBe(false)
    expect(belongsTo(WS, { contactId: 'c' }, { contact: { workspace_id: 'other' } })).toBe(false)
    expect(belongsTo(WS, { surveyId: S, reportId: 'p' }, { survey: { id: S, workspace_id: WS }, report: { workspace_id: WS, survey_id: 'x' } })).toBe(false)
    expect(belongsTo(WS, { contactId: 'c' }, {})).toBe(false)
  })
})
