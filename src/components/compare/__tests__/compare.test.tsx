import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const WS = '99999999-9999-4999-8999-999999999999'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const V = { [S1]: 'aaaaaaaa-0000-4000-8000-000000000001', [S2]: 'aaaaaaaa-0000-4000-8000-000000000002' } as Record<string, string>
const TITLE = { [S1]: 'Spring pulse', [S2]: 'Autumn pulse' } as Record<string, string>

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  requireMember: vi.fn(async () => ({ supabase: {}, workspace: { id: WS, archived_at: null }, user: { id: WS }, role: 'viewer', readOnly: false })),
}))

const surveyRow = (id: string) => ({
  id,
  workspace_id: WS,
  title: TITLE[id],
  slug: 'abcdefghij',
  state: 'open',
  latest_published_version_id: V[id],
  closes_at: null,
  complete_count: 0,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
})

vi.mock('@/lib/db/surveys', () => ({
  listSurveysLite: vi.fn(async () => ({ ok: true, data: [surveyRow(S1), surveyRow(S2)] })),
  getSurvey: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({ ok: true, data: TITLE[surveyId] ? surveyRow(surveyId) : null })),
  listPublishedVersions: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({
    ok: true,
    data: [{ id: V[surveyId], version_no: 1, status: 'published', published_at: null }],
  })),
}))

const q = (s: string, key: string, type: string, label: string, position: number) => ({
  survey_version_id: V[s],
  question_key: key,
  type,
  label,
  position,
  page_index: 0,
  is_pii: false,
  options: null,
  config: {},
})

const resp = (s: string, i: number) => ({
  id: `cccccccc-0000-4000-8000-${s.slice(0, 1)}0000000000${i}`,
  survey_version_id: V[s],
  status: 'complete',
  started_at: '2026-10-01T10:00:00Z',
  submitted_at: '2026-10-01T10:01:00Z',
  contact_id: null,
  identity_source: null,
  respondent_token_id: null,
  metadata: {},
})

vi.mock('@/lib/db/responses', () => ({
  listSurveyQuestionRows: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({
    ok: true,
    data:
      surveyId === S1
        ? [q(S1, 'q_nnnnnnnn', 'nps', 'Recommend us', 0), q(S1, 'q_aaaaaaaa', 'number', 'Team size', 1), q(S1, 'q_xxxxxxxx', 'long_text', 'Only in spring', 2)]
        : [q(S2, 'q_nnnnnnnn', 'nps', 'Recommend us', 0), q(S2, 'q_bbbbbbbb', 'number', 'team size?', 1), q(S2, 'q_yyyyyyyy', 'date', 'Only in autumn', 2)],
  })),
  readFilteredResponses: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({ ok: true, data: [0, 1, 2, 3].map((i) => resp(surveyId, i)) })),
  readAnswers: vi.fn(async (_c: unknown, { responseIds }: { responseIds: string[] }) => ({
    ok: true,
    data: responseIds.flatMap((id, i) => {
      const s1 = id.includes('-10000000000')
      return [
        { response_id: id, question_key: 'q_nnnnnnnn', survey_version_id: '', value_text: null, value_number: s1 ? 10 : i === 0 ? 10 : 3, value_date: null, value_json: null },
        { response_id: id, question_key: s1 ? 'q_aaaaaaaa' : 'q_bbbbbbbb', survey_version_id: '', value_text: null, value_number: s1 ? 4 : 6, value_date: null, value_json: null },
      ]
    }),
  })),
}))

vi.mock('@/lib/db/events', () => ({ readEvents: vi.fn(async () => ({ ok: true, data: [] })) }))

const { default: ComparePage } = await import('@/app/(dashboard)/w/[slug]/compare/page')
const { CompareWithLink } = await import('../CompareWithLink')

async function render(sp: Record<string, string>) {
  return renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ slug: 'team' }), searchParams: Promise.resolve(sp) }))
}

describe('Compare page (mocked wrappers)', () => {
  it('asks for surveys when fewer than two are picked', async () => {
    const h = await render({ surveys: S1 })
    expect(h).toContain('Pick two to five surveys')
    expect(h).toContain('Spring pulse')
  })

  it('shows matched questions side by side with differences and unmatched lists', async () => {
    const h = await render({ surveys: `${S1},${S2}` })
    expect(h).toContain('Matched questions (2)')
    expect(h).toContain('matched by question key')
    expect(h).toContain('matched by label and type')
    // NPS: 100 in spring, 4 answers in autumn with one promoter and three detractors = -50.
    expect(h).toContain('-150 NPS')
    expect(h).toContain('+2')
    expect(h).toContain('Only in spring')
    expect(h).toContain('Only in autumn')
    expect(h).toContain('Export comparison XLSX')
    expect(h).toContain('Completion rate')
    expect(h).toContain('aria-label="NPS 100')
  })
})

describe('CompareWithLink', () => {
  it('preselects the survey', () => {
    expect(renderToStaticMarkup(<CompareWithLink slug="team" surveyId={S1} />)).toContain(`href="/w/team/compare?surveys=${S1}"`)
  })
})
