import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone'

describe('normalizePhone', () => {
  it('parses national US numbers with the default country', () => {
    expect(normalizePhone('(559) 555-1234', 'US')).toBe('+15595551234')
    expect(normalizePhone('(213) 373-4253', 'US')).toBe('+12133734253')
    expect(normalizePhone('213.373.4253', 'US')).toBe('+12133734253')
  })
  it('keeps international numbers regardless of the default country', () => {
    expect(normalizePhone('+44 20 7946 0958', 'US')).toBe('+442079460958')
    expect(normalizePhone('0044 20 7946 0958', 'US')).toBe('+442079460958')
  })
  it('uses the workspace country for national formats', () => {
    expect(normalizePhone('020 7946 0958', 'GB')).toBe('+442079460958')
    expect(normalizePhone('030 123456', 'DE')).toBe('+4930123456')
  })
  it('returns null for blanks and garbage', () => {
    expect(normalizePhone('', 'US')).toBeNull()
    expect(normalizePhone(null, 'US')).toBeNull()
    expect(normalizePhone('call me', 'US')).toBeNull()
    expect(normalizePhone('12', 'US')).toBeNull()
  })
  it('survives an unknown default country', () => {
    expect(normalizePhone('+12133734253', 'ZZ')).toBe('+12133734253')
    expect(normalizePhone('2133734253', 'ZZ')).toBeNull()
  })
})
