import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defn, q, rt } from '@/lib/survey/__tests__/fixtures'

/**
 * POST /api/public/submit with every data dependency mocked. Each mock
 * records its name in `calls`, so a failure path proves which checks ran
 * before it and that nothing after it ran (doc 02 section 5.1).
 */

const calls: string[] = []

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const resolvePublicSurvey = vi.fn()
vi.mock('@/lib/db/publicRead', () => ({
  resolvePublicSurvey: (...a: unknown[]) => {
    calls.push('survey')
    return resolvePublicSurvey(...a)
  },
  getPublicDefinition: vi.fn(),
}))

const rateLimitHit = vi.fn()
const submitResponse = vi.fn()
const publishedVersion = vi.fn()
vi.mock('@/lib/db/submission', () => ({
  publishedVersion: (_c: unknown, input: unknown) => {
    calls.push('version')
    return publishedVersion(input)
  },
  rateLimitHit: (_c: unknown, input: { bucket: string }) => {
    calls.push(`rate:${input.bucket}`)
    return rateLimitHit(input)
  },
  submitResponse: (_c: unknown, payload: unknown) => {
    calls.push('submit_response')
    return submitResponse(payload)
  },
}))

vi.mock('@/lib/db/limits', () => ({
  GLOBAL_LIMIT_DEFAULTS: { rate_limit_per_hour: 20, raw_script_pixels_allowed: true, max_files_per_response: 20 },
  // resolve_public_survey returns workspace_id (0018), so the context step reads only the limits.
  getEffectiveLimits: async (_c: unknown, input: { workspaceId: string }) => {
    calls.push('context')
    expect(input.workspaceId).toBe(WS_ID)
    return { ok: true, data: { rate_limit_per_hour: 7, raw_script_pixels_allowed: true, max_files_per_response: 20 } }
  },
}))

const SURVEY_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'
const WS_ID = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

const DEF = defn({
  questions: [
    q({ id: 'q_name0001', type: 'short_text', settings: {}, required: true, label: rt('Name') }),
    q({ id: 'q_note0001', type: 'long_text', settings: {} }),
  ],
})

const OPEN = {
  survey_id: SURVEY_ID,
  slug: 'abcdefghij',
  alias: null,
  matched_by: 'slug',
  effective_state: 'open',
  state_reason: null,
  opens_at: null,
  closes_at: null,
  closed_message: null,
  version_id: VERSION_ID,
  version_no: 1,
  title: 'T',
  og_title: null,
  og_description: null,
  og_image_path: null,
  allow_indexing: false,
  workspace_id: WS_ID,
  workspace_name: 'W',
  logo_path: null,
  show_powered_by: true,
  privacy_notice_url: null,
  pixel_consent_mode: 'banner',
  pixels: [],
}

function body(over: Record<string, unknown> = {}) {
  return {
    action: 'complete',
    key: 'abcdefghij',
    surveyId: SURVEY_ID,
    versionId: VERSION_ID,
    idempotencyKey: '0f8fad5b-d9cb-469f-a165-70867728950e',
    answers: { q_name0001: 'Ada' },
    hidden: { src: 'qr' },
    uploadIds: [],
    startedAt: '2026-10-21T10:00:00Z',
    turnstileToken: 'tok',
    website: '',
    ...over,
  }
}

function req(b: unknown, init: { method?: string; type?: string } = {}) {
  return new Request('http://s.example.org/api/public/submit', {
    method: init.method ?? 'POST',
    headers: { 'content-type': init.type ?? 'application/json', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    body: init.method === 'GET' ? undefined : JSON.stringify(b),
  })
}

const { POST } = await import('@/app/api/public/submit/route')
const handle = async (r: Request) => {
  const res = await POST(r)
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

beforeEach(() => {
  calls.length = 0
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'real-secret')
  vi.stubEnv('PUBLIC_HOST', 's.example.org')
  vi.stubEnv('RATE_LIMIT_SECRET', 'test-rate-limit-secret')
  resolvePublicSurvey.mockReset().mockResolvedValue({ ok: true, data: OPEN })
  rateLimitHit.mockReset().mockResolvedValue({ ok: true, data: true })
  publishedVersion.mockReset().mockResolvedValue({
    ok: true,
    data: { id: VERSION_ID, survey_id: SURVEY_ID, workspace_id: WS_ID, version_no: 1, definition: DEF },
  })
  submitResponse.mockReset().mockResolvedValue({ ok: true, data: { ok: true, response_id: 'r1' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls.push('turnstile')
      return new Response(JSON.stringify({ success: true, action: 'submit', hostname: 's.example.org' }))
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/public/submit, order of checks', () => {
  it('1. refuses a non-JSON content type before anything else', async () => {
    const r = await handle(req(body(), { type: 'text/plain' }))
    expect(r.status).toBe(415)
    expect(calls).toEqual([])
  })

  it('1. refuses an oversized body before parsing', async () => {
    const r = await handle(req(body({ answers: { q_note0001: 'x'.repeat(300 * 1024) } })))
    expect(r.status).toBe(413)
    expect(calls).toEqual([])
  })

  it('2. refuses a bad shape with 400 before any lookup', async () => {
    const r = await handle(req(body({ idempotencyKey: 'not-a-uuid' })))
    expect(r).toMatchObject({ status: 400, json: { ok: false, code: 'invalid_request' } })
    expect(calls).toEqual([])
  })

  it('3. unknown survey is a 404 after only the survey lookup', async () => {
    resolvePublicSurvey.mockResolvedValue({ ok: true, data: null })
    const r = await handle(req(body()))
    expect(r).toMatchObject({ status: 404, json: { code: 'not_found' } })
    expect(calls).toEqual(['survey'])
  })

  it('3. a survey id that does not match the key is a 404', async () => {
    const r = await handle(req(body({ surveyId: '44444444-4444-4444-8444-444444444444' })))
    expect(r.status).toBe(404)
    expect(calls).toEqual(['survey'])
  })

  it('3. closed, scheduled and capped surveys stop at the state check', async () => {
    for (const [state, reason, code] of [
      ['closed', 'manual', 'survey_closed'],
      ['scheduled', null, 'not_open_yet'],
      ['closed', 'cap', 'cap_reached'],
    ] as const) {
      calls.length = 0
      resolvePublicSurvey.mockResolvedValue({ ok: true, data: { ...OPEN, effective_state: state, state_reason: reason, version_id: null } })
      const r = await handle(req(body()))
      expect(r).toMatchObject({ status: 409, json: { code } })
      expect(calls).toEqual(['survey'])
    }
  })

  it('4. honeypot answers a fake success and writes nothing', async () => {
    const r = await handle(req(body({ website: 'http://spam.example' })))
    expect(r.status).toBe(200)
    expect(r.json?.ok).toBe(true)
    expect(calls).toEqual(['survey'])
  })

  it('5. rate limits run before Turnstile; a limited request never reaches siteverify', async () => {
    rateLimitHit.mockImplementation(async (input: { bucket: string }) => ({ ok: true, data: input.bucket !== 'submit:create' }))
    const r = await handle(req(body()))
    expect(r).toMatchObject({ status: 429, json: { code: 'rate_limited', retryAfter: 600 } })
    expect(calls).toEqual(['survey', 'context', 'rate:submit:survey', 'rate:submit:create'])
  })

  it('5. complete uses the workspace rate limit from effective_limits', async () => {
    await handle(req(body({ resumeToken: TOKEN })))
    const completeCall = rateLimitHit.mock.calls.find((c) => (c[0] as { bucket: string }).bucket === 'submit:complete')
    expect(completeCall?.[0]).toMatchObject({ window: '1 hour', max: 7 })
  })

  it('6. a failed captcha is a 403 before the version is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.push('turnstile')
        return new Response(JSON.stringify({ success: false }))
      }),
    )
    const r = await handle(req(body()))
    expect(r).toMatchObject({ status: 403, json: { code: 'captcha_failed' } })
    expect(calls.at(-1)).toBe('turnstile')
    expect(calls).not.toContain('version')
    expect(calls.indexOf('rate:submit:survey')).toBeLessThan(calls.indexOf('turnstile'))
  })

  it('6. a save with a resume token skips Turnstile', async () => {
    const r = await handle(req(body({ action: 'save', resumeToken: TOKEN, turnstileToken: undefined })))
    expect(r.status).toBe(200)
    expect(calls).not.toContain('turnstile')
    expect(calls.at(-1)).toBe('submit_response')
  })

  it('7, 8. final validation failure is a 422 with inline errors and never calls submit_response', async () => {
    const r = await handle(req(body({ answers: {} })))
    expect(r.status).toBe(422)
    expect(r.json).toMatchObject({ ok: false, code: 'validation_failed', fieldErrors: { q_name0001: 'This field is required.' } })
    expect(calls).toContain('version')
    expect(calls).not.toContain('submit_response')
  })

  it('9. success: full order and the payload submit_response receives', async () => {
    const r = await handle(req(body({ answers: { q_name0001: 'Ada', q_unknown1: 'x' }, respondentHash: 'a'.repeat(32) })))
    expect(r).toMatchObject({ status: 200, json: { ok: true, responseId: 'r1', endingId: 'e_default1' } })
    expect(calls).toEqual([
      'survey',
      'context',
      'rate:submit:survey',
      'rate:submit:create',
      'rate:submit:complete',
      'turnstile',
      'version',
      'submit_response',
    ])
    const payload = submitResponse.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).toMatchObject({
      action: 'complete',
      survey_id: SURVEY_ID,
      survey_version_id: VERSION_ID,
      answers: { q_name0001: { value_text: 'Ada' } },
      visible_keys: ['q_name0001', 'q_note0001'],
      file_ids: [],
      ip: '203.0.113.9',
      respondent_hash: 'a'.repeat(32),
      metadata: { hidden: { src: 'qr' } },
    })
    expect(payload).not.toHaveProperty('resume_token_hash')
  })

  it('9. passes the resume token as its sha256 hash, never the token', async () => {
    await handle(req(body({ resumeToken: TOKEN })))
    const payload = submitResponse.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.resume_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(payload)).not.toContain(TOKEN)
  })

  it('9. maps submit_response outcomes to HTTP codes and field messages', async () => {
    submitResponse.mockResolvedValue({ ok: true, data: { ok: false, code: 'cap_reached' } })
    expect(await handle(req(body()))).toMatchObject({ status: 409, json: { code: 'cap_reached' } })
    submitResponse.mockResolvedValue({ ok: true, data: { ok: false, code: 'token_invalid' } })
    expect((await handle(req(body()))).status).toBe(403)
    submitResponse.mockResolvedValue({ ok: true, data: { ok: false, code: 'validation_failed', field_errors: { q_name0001: 'required' } } })
    expect(await handle(req(body()))).toMatchObject({ status: 422, json: { fieldErrors: { q_name0001: 'This field is required.' } } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    submitResponse.mockResolvedValue({ ok: false, error: { code: 'network' } })
    expect(await handle(req(body()))).toMatchObject({ status: 500, json: { code: 'server_error' } })
  })

  it('returns the resume token and score shape on save and complete', async () => {
    submitResponse.mockResolvedValue({ ok: true, data: { ok: true, response_id: 'r2', resume_token: TOKEN } })
    expect((await handle(req(body({ action: 'save' })))).json).toMatchObject({ ok: true, responseId: 'r2', resumeToken: TOKEN })
    submitResponse.mockResolvedValue({ ok: true, data: { ok: true, response_id: 'r3', score: 4, score_max: 5 } })
    expect((await handle(req(body()))).json).toMatchObject({ score: { value: 4, max: 5 } })
  })
})
