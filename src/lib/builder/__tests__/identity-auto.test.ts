import { describe, expect, it } from 'vitest'
import { lintDefinition } from '@/lib/survey'
import { defn, q } from '@/lib/survey/__tests__/fixtures'
import { addQuestion, changeType } from '../ops'

const EMAIL = q({ id: 'q_email0001', type: 'email', settings: {} })
const PHONE = q({ id: 'q_phone0001', type: 'phone', settings: {} })
const TEXT = q({ id: 'q_text00001', type: 'short_text', settings: {} })

describe('identity key auto-assignment', () => {
  it('makes the first email question the identity key when none is set', () => {
    const d = addQuestion(defn({ questions: [], pages: [{ id: 'p_one00001', question_ids: [] }] }), EMAIL, 'p_one00001')
    expect(d.identity.email_question_id).toBe('q_email0001')
  })

  it('does not replace an identity key that is already set', () => {
    const base = defn({ questions: [EMAIL], pages: [{ id: 'p_one00001', question_ids: ['q_email0001'] }] })
    const withKey = { ...base, identity: { email_question_id: 'q_email0001' } }
    const second = q({ id: 'q_email0002', type: 'email', settings: {} })
    const d = addQuestion(withKey, second, 'p_one00001')
    expect(d.identity.email_question_id).toBe('q_email0001')
  })

  it('assigns phone the same way', () => {
    const d = addQuestion(defn({ questions: [], pages: [{ id: 'p_one00001', question_ids: [] }] }), PHONE, 'p_one00001')
    expect(d.identity.phone_question_id).toBe('q_phone0001')
  })

  it('assigns when a text question is changed into an email question', () => {
    const base = defn({ questions: [TEXT], pages: [{ id: 'p_one00001', question_ids: ['q_text00001'] }] })
    const d = changeType(base, 'q_text00001', 'email', {}, new Set<string>())
    expect(d.identity.email_question_id).toBe('q_text00001')
  })

  it('lint warns when an email question exists without an identity key', () => {
    const base = defn({ questions: [EMAIL], pages: [{ id: 'p_one00001', question_ids: ['q_email0001'] }] })
    const noKey = { ...base, identity: {} }
    const r = lintDefinition(noKey)
    expect(r.issues.some((i) => i.code === 'identity_missing' && i.severity === 'warning')).toBe(true)
  })
})
