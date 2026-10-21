import { describe, expect, it } from 'vitest'
import {
  clearAfterComplete,
  keys,
  loadMirror,
  loadResumeToken,
  saveMirror,
  saveResumeToken,
  takeUrlTokens,
  type StoreLike,
} from '../resumeStore'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

function memStore(): StoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('resume token storage', () => {
  it('stores under survey:{surveyId}:resume and refuses malformed tokens', () => {
    const s = memStore()
    saveResumeToken(s, 'sid', TOKEN)
    expect(s.data.get('survey:sid:resume')).toBe(TOKEN)
    expect(loadResumeToken(s, 'sid')).toBe(TOKEN)
    saveResumeToken(s, 'sid', 'bad token')
    expect(loadResumeToken(s, 'sid')).toBeNull()
    s.data.set(keys.resume('sid'), '<script>')
    expect(loadResumeToken(s, 'sid')).toBeNull()
  })

  it('survives blocked storage', () => {
    const throwing: StoreLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => saveResumeToken(throwing, 'sid', TOKEN)).not.toThrow()
    expect(loadResumeToken(throwing, 'sid')).toBeNull()
    expect(loadResumeToken(null, 'sid')).toBeNull()
  })

  it('mirrors answers per version and clears everything after completion except the respondent id', () => {
    const s = memStore()
    saveMirror(s, 'sid', { versionId: 'v1', answers: { q_a: 'x' }, savedAt: 'now' })
    expect(loadMirror(s, 'sid', 'v1')?.answers).toEqual({ q_a: 'x' })
    expect(loadMirror(s, 'sid', 'v2')).toBeNull()
    saveResumeToken(s, 'sid', TOKEN)
    s.data.set(keys.respondent('sid'), 'rid')
    clearAfterComplete(s, 'sid')
    expect(loadResumeToken(s, 'sid')).toBeNull()
    expect(loadMirror(s, 'sid', 'v1')).toBeNull()
    expect(s.data.get(keys.respondent('sid'))).toBe('rid')
  })
})

describe('takeUrlTokens', () => {
  it('reads r and t and strips both, keeping other params', () => {
    const out = takeUrlTokens(`https://s.example.org/abcdefghij?src=qr&r=${TOKEN}&t=tok123#x`)
    expect(out.resumeToken).toBe(TOKEN)
    expect(out.respondentToken).toBe('tok123')
    expect(out.cleanUrl).toBe('/abcdefghij?src=qr#x')
  })

  it('leaves the URL alone when neither is present', () => {
    expect(takeUrlTokens('https://s.example.org/abcdefghij?src=qr').cleanUrl).toBeNull()
  })

  it('strips a malformed r but does not use it', () => {
    const out = takeUrlTokens('https://s.example.org/abcdefghij?r=nope')
    expect(out.resumeToken).toBeNull()
    expect(out.cleanUrl).toBe('/abcdefghij')
  })
})
