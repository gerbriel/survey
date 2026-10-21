import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_TYPES, QUIZ } from '@/lib/survey/__tests__/fixtures'
import { containsServerOnlyKeys } from '@/lib/survey'

vi.mock('server-only', () => ({}))

const saveDraft = vi.fn()
const publishSurveyVersion = vi.fn()
const getSurvey = vi.fn()
const getVersion = vi.fn()

vi.mock('@/lib/db/surveys', () => ({
  saveDraft: (...a: unknown[]) => saveDraft(...a),
  getSurvey: (...a: unknown[]) => getSurvey(...a),
  getVersion: (...a: unknown[]) => getVersion(...a),
}))
vi.mock('@/lib/db/publish', () => ({ publishSurveyVersion: (...a: unknown[]) => publishSurveyVersion(...a) }))

const { publishDraft } = await import('../publish')

const SURVEY = { id: '00000000-0000-4000-8000-0000000000aa', current_draft_version_id: '00000000-0000-4000-8000-0000000000bb', latest_published_version_id: null, complete_count: 0 }
const client = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  getSurvey.mockResolvedValue({ ok: true, data: SURVEY })
  saveDraft.mockResolvedValue({ ok: true, data: 8 })
  publishSurveyVersion.mockResolvedValue({ ok: true, data: '00000000-0000-4000-8000-0000000000cc' })
  getVersion.mockResolvedValue({ ok: true, data: { id: '00000000-0000-4000-8000-0000000000cc', revision: 0, version_no: 2 } })
})

describe('publishDraft', () => {
  it('saves at the expected revision, then publishes the stripped half at the new revision', async () => {
    const r = await publishDraft(client, { surveyId: SURVEY.id, versionId: SURVEY.current_draft_version_id, expectedRevision: 7, definition: QUIZ, acknowledgeBreaking: false })
    expect(r).toEqual({ ok: true, data: { status: 'published', newDraftVersionId: '00000000-0000-4000-8000-0000000000cc', revision: 0, versionNo: 1 } })
    expect(saveDraft.mock.calls[0]?.[1]).toMatchObject({ versionId: SURVEY.current_draft_version_id, expectedRevision: 7 })
    const pub = publishSurveyVersion.mock.calls[0]?.[1] as { expectedRevision: number; publicDefinition: unknown }
    expect(pub.expectedRevision).toBe(8)
    expect(containsServerOnlyKeys(pub.publicDefinition)).toBe(false)
  })

  it('blocks on lint errors without touching the database', async () => {
    const broken = { ...ALL_TYPES, endings: [] }
    const r = await publishDraft(client, { surveyId: SURVEY.id, versionId: SURVEY.current_draft_version_id, expectedRevision: 1, definition: broken, acknowledgeBreaking: false })
    expect(r.ok && r.data.status).toBe('lint_failed')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('asks for acknowledgment of breaking changes when the survey has responses', async () => {
    getSurvey.mockResolvedValue({ ok: true, data: { ...SURVEY, latest_published_version_id: '00000000-0000-4000-8000-0000000000dd', complete_count: 3 } })
    getVersion.mockResolvedValueOnce({ ok: true, data: { definition: QUIZ } })
    const q2 = QUIZ.questions.q_quiz0002 as { settings: { options: unknown[] } }
    const removed = { ...QUIZ, questions: { ...QUIZ.questions, q_quiz0002: { ...q2, settings: { ...q2.settings, options: q2.settings.options.slice(0, 2), correct_option_ids: ['o_q2a00001', 'o_q2b00001'] } } } }
    const r = await publishDraft(client, { surveyId: SURVEY.id, versionId: SURVEY.current_draft_version_id, expectedRevision: 1, definition: removed, acknowledgeBreaking: false })
    expect(r.ok && r.data.status).toBe('needs_ack')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('passes revision_conflict from the save through', async () => {
    saveDraft.mockResolvedValue({ ok: false, error: { code: 'revision_conflict', message: 'x' } })
    const r = await publishDraft(client, { surveyId: SURVEY.id, versionId: SURVEY.current_draft_version_id, expectedRevision: 1, definition: QUIZ, acknowledgeBreaking: false })
    expect(!r.ok && r.error.code).toBe('revision_conflict')
    expect(publishSurveyVersion).not.toHaveBeenCalled()
  })
})
