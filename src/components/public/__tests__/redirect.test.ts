import { describe, expect, it } from 'vitest'
import { redirectDelaySeconds, safeRedirectUrl } from '../redirect'

describe('safeRedirectUrl', () => {
  it('allows https only', () => {
    expect(safeRedirectUrl('https://example.org/next')).toBe('https://example.org/next')
    expect(safeRedirectUrl('http://example.org/next')).toBeNull()
    expect(safeRedirectUrl('javascript:alert(1)')).toBeNull()
    expect(safeRedirectUrl('JAVASCRIPT:alert(1)')).toBeNull()
    expect(safeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeRedirectUrl('//evil.example.org')).toBeNull()
    expect(safeRedirectUrl('/relative')).toBeNull()
    expect(safeRedirectUrl('')).toBeNull()
    expect(safeRedirectUrl(null)).toBeNull()
    expect(safeRedirectUrl('  https://example.org/a  ')).toBe('https://example.org/a')
  })

  it('refuses credentials in the URL', () => {
    expect(safeRedirectUrl('https://user:pass@example.org/')).toBeNull()
  })

  it('appends hidden fields only when asked and never overwrites', () => {
    const hidden = { src: 'qr', utm_source: 'mail' }
    expect(safeRedirectUrl('https://example.org/?src=keep', { hidden })).toBe('https://example.org/?src=keep')
    expect(safeRedirectUrl('https://example.org/?src=keep', { hidden, passParams: true })).toBe(
      'https://example.org/?src=keep&utm_source=mail',
    )
  })

  it('clamps the delay to 0 to 10 seconds', () => {
    expect(redirectDelaySeconds(3)).toBe(3)
    expect(redirectDelaySeconds(-2)).toBe(0)
    expect(redirectDelaySeconds(99)).toBe(10)
    expect(redirectDelaySeconds('5')).toBe(0)
    expect(redirectDelaySeconds(Number.NaN)).toBe(0)
  })
})
