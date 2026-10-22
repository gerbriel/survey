import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const WS = '99999999-9999-4999-8999-999999999999'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const V1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const V2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const R1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const R2 = 'bbbbbbbb-0000-4000-8000-000000000002'

const role = { current: 'editor' as 'viewer' | 'editor' }

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  requireMember: vi.fn(async () => ({ supabase: {}, workspace: { id: WS, archived_at: null }, user: { id: WS }, role: role.current, readOnly: false })),
}))

vi.mock('@/lib/db/workspaces', () => ({
  listMembers: vi.fn(async () => ({ ok: true, data: [{ user_id: WS, display_name: 'Owner One' }] })),
}))

const survey = (id: string, title: string, state: string) => ({
  id,
  workspace_id: WS,
  title,
  slug: 'abcdefghij',
  state,
  latest_published_version_id: id === S1 ? V1 : V2,
  closes_at: null,
  complete_count: 0,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
})

vi.mock('@/lib/db/surveys', () => ({
  listSurveysLite: vi.fn(async () => ({ ok: true, data: [survey(S1, 'Spring pulse', 'open'), survey(S2, 'Autumn pulse', 'closed'), { ...survey(S2, 'Draft', 'draft'), id: WS }] })),
  listPublishedVersions: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({
    ok: true,
    data: [{ id: surveyId === S1 ? V1 : V2, version_no: 1, status: 'published', published_at: null }],
  })),
}))

const qrow = (v: string, key: string, type: string, label: string, position: number) => ({
  survey_version_id: v,
  question_key: key,
  type,
  label,
  position,
  page_index: 0,
  is_pii: false,
  options: type === 'single_choice' ? [{ id: 'o1', label: 'Great' }] : null,
  config: {},
})

const readResultRows = vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({
  ok: true,
  data:
    surveyId === S1
      ? [
          {
            id: R1,
            survey_id: S1,
            survey_version_id: V1,
            status: 'complete',
            contact_id: null,
            respondent_token_id: null,
            identity_source: null,
            started_at: '2026-10-01T10:00:00Z',
            submitted_at: '2026-10-01T10:02:00Z',
            last_question_key: null,
            score: null,
            score_max: null,
            metadata: { device: 'mobile' },
            contact: null,
          },
        ]
      : [
          {
            id: R2,
            survey_id: S2,
            survey_version_id: V2,
            status: 'partial',
            contact_id: WS,
            respondent_token_id: null,
            identity_source: 'email',
            started_at: '2026-10-02T10:00:00Z',
            submitted_at: null,
            last_question_key: null,
            score: null,
            score_max: null,
            metadata: {},
            contact: { id: WS, email: null, first_name: 'Ada', last_name: 'Lovelace' },
          },
        ],
}))

vi.mock('@/lib/db/responses', () => ({
  listSurveyQuestionRows: vi.fn(async (_c: unknown, { surveyId }: { surveyId: string }) => ({
    ok: true,
    data:
      surveyId === S1
        ? [qrow(V1, 'q_aaaaaaaa', 'single_choice', 'How was it', 0), qrow(V1, 'q_bbbbbbbb', 'long_text', 'Why', 1)]
        : [qrow(V2, 'q_aaaaaaaa', 'single_choice', 'How was it', 0), qrow(V2, 'q_cccccccc', 'number', 'Age', 1)],
  })),
  readResultRows: (c: unknown, input: { surveyId: string }) => readResultRows(c, input),
  searchTextAnswers: vi.fn(async () => ({ ok: true, data: { responseIds: [R1], capped: false } })),
  readAnswers: vi.fn(async () => ({
    ok: true,
    data: [{ response_id: R1, question_key: 'q_aaaaaaaa', survey_version_id: V1, value_text: 'o1', value_number: null, value_date: null, value_json: null }],
  })),
}))

const { default: ResultsPage } = await import('@/app/(dashboard)/w/[slug]/results/page')
const { ResultsTable } = await import('../ResultsTable')

async function render(sp: Record<string, string> = {}) {
  const el = await ResultsPage({ params: Promise.resolve({ slug: 'team' }), searchParams: Promise.resolve(sp) })
  return renderToStaticMarkup(el)
}

describe('Results hub page (mocked wrappers)', () => {
  beforeEach(() => {
    role.current = 'editor'
    readResultRows.mockClear()
  })

  it('lists responses across the default surveys, newest first, with summary and links', async () => {
    const h = await render()
    expect(readResultRows).toHaveBeenCalledTimes(2) // the draft is not in the default set
    expect(h).toContain('Spring pulse')
    expect(h).toContain('Autumn pulse')
    expect(h.indexOf('Autumn pulse</a>')).toBeLessThan(h.indexOf('Spring pulse</a>'))
    expect(h).toContain(`/w/team/surveys/${S1}/responses/${R1}`)
    expect(h).toContain('Ada Lovelace')
    expect(h).toContain('Anonymous')
    expect(h).toContain('>Great<')
    expect(h).toContain('Completion rate')
    expect(h).toContain('50%')
    expect(h).toContain('Unique contacts')
    expect(h).toContain('Export XLSX')
    expect(h).toContain('Compare these surveys')
  })

  it('applies status and free text filters and hides row exports from viewers', async () => {
    role.current = 'viewer'
    const h = await render({ status: 'complete', q: 'slow' })
    expect(h).toContain(`/responses/${R1}`)
    expect(h).not.toContain(`/responses/${R2}`)
    expect(h).not.toContain('Export CSV')
  })

  it('passes the per survey query to the wrapper', async () => {
    await render({ status: 'partial', mk: 'utm_source', mv: 'mail' })
    expect(readResultRows.mock.calls[0]![1]).toMatchObject({
      surveyId: S1,
      filters: { version: 'all', status: 'all', identity: 'all' },
      where: [{ column: 'metadata->>utm_source', value: 'mail' }],
    })
  })
})

describe('ResultsTable', () => {
  it('renders an empty state and pagination', () => {
    expect(renderToStaticMarkup(<ResultsTable rows={[]} columns={[]} total={0} page={0} pageSize={25} pageHref={() => '#'} />)).toContain('No responses match')
    const row = { id: R1, href: '/x', survey: 'S', status: 'complete' as const, submittedAt: '2026-10-01T10:00:00Z', startedAt: '2026-10-01T09:00:00Z', respondent: 'Anonymous', version: 'v1', device: 'desktop', cells: ['Yes'] }
    const h = renderToStaticMarkup(
      <ResultsTable rows={[row]} columns={[{ key: 'q_aaaaaaaa', label: 'Q', type: 'yes_no', surveys: 1 }]} total={60} page={1} pageSize={25} pageHref={(p) => `/p${p}`} />,
    )
    expect(h).toContain('26 to 26 of 60')
    expect(h).toContain('Page 2 of 3')
    expect(h).toContain('href="/p0"')
    expect(h).toContain('href="/p2"')
  })
})
