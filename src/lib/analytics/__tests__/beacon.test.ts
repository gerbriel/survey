import { describe, expect, it } from 'vitest'
import { beaconEnvelope, beaconEvent, parseBeacon } from '../beacon-schema'

const S = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const env = (events: unknown[], extra: Record<string, unknown> = {}) => ({ survey_id: S, survey_version_id: V, rid: 'abcDEF123_-xyz', events, ...extra })

describe('beacon schema', () => {
  it('accepts the documented vocabulary', () => {
    for (const type of ['view', 'start', 'question_view', 'question_answer', 'page_next', 'page_back', 'abandon', 'file_upload']) {
      expect(beaconEvent.safeParse({ type }).success).toBe(true)
    }
  })
  it('rejects complete, which only the server emits', () => {
    expect(beaconEvent.safeParse({ type: 'complete' }).success).toBe(false)
    const p = parseBeacon(env([{ type: 'complete' }, { type: 'view' }]))!
    expect(p.events.map((e) => e.type)).toEqual(['view'])
    expect(p.dropped).toBe(1)
  })
  it('drops unknown types and bad events one by one', () => {
    const p = parseBeacon(env([{ type: 'hover' }, 'x', { type: 'start' }]))!
    expect(p.events).toHaveLength(1)
    expect(p.dropped).toBe(2)
  })
  it('strips meta to the allow-list and nulls bad question keys', () => {
    const p = parseBeacon(
      env([
        {
          type: 'question_answer',
          question_key: 'email',
          occurred_at: '2026-10-21T10:00:00Z',
          meta: { page: 2, value: 'secret answer', email: 'a@b.co', device: 'phone', utm: { utm_source: 'news', other: 'x' } },
        },
      ]),
    )!
    const e = p.events[0]!
    expect(e.question_key).toBeNull()
    expect(e.occurred_at).toBe('2026-10-21T10:00:00.000Z')
    expect(e.meta).toEqual({ page: 2, utm: { utm_source: 'news' } })
  })
  it('requires a valid envelope', () => {
    expect(parseBeacon(env([]))).toBeNull()
    expect(parseBeacon(env(new Array(51).fill({ type: 'view' })))).toBeNull()
    expect(parseBeacon(env([{ type: 'view' }], { rid: undefined }))).toBeNull()
    expect(parseBeacon(env([{ type: 'view' }], { rid: 'a b' }))).toBeNull()
    expect(parseBeacon({ ...env([{ type: 'view' }]), survey_id: 'nope' })).toBeNull()
    expect(beaconEnvelope.safeParse(env([{ type: 'view' }], { rid: undefined, respondent_hash: 'abcdefgh12' })).success).toBe(true)
  })
})
