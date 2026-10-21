import { describe, expect, it } from 'vitest'
import { isSafeRegex, MAX_REGEX_LENGTH } from '../regex'

describe('isSafeRegex', () => {
  it('accepts ordinary patterns', () => {
    for (const p of ['^\\d{5}$', '^[A-Z]{2}-\\d+$', '^(foo|bar)$', '(?:ab)+', '^a+b*$', '[(+*)]+', '(a)(b)?', '\\(x+\\)+']) expect(isSafeRegex(p)).toBe(true)
  })

  it('rejects nested quantifiers, backrefs, lookarounds, invalid and long patterns', () => {
    for (const p of ['(a+)+', '(a*)*', '((ab)+)+', '(\\w+\\s?)*$', '(a{1,3}){2,}', '(a)\\1', '(?=a)', '(?<!a)b', '(?<n>a)\\k<n>', '[', '', 'a'.repeat(MAX_REGEX_LENGTH + 1)]) {
      expect(isSafeRegex(p)).toBe(false)
    }
    expect(isSafeRegex(5 as unknown as string)).toBe(false)
  })
})
