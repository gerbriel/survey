import { describe, expect, it } from 'vitest'
import { authCallbackUrl, dashboardOrigin, loginPath, safeNextPath } from '../paths'

describe('safeNextPath', () => {
  it.each([
    ['/w/hr/surveys', '/w/hr/surveys'],
    ['/w/hr?tab=members#top', '/w/hr?tab=members#top'],
    ['/', '/'],
  ])('keeps same-origin path %s', (input, out) => {
    expect(safeNextPath(input)).toBe(out)
  })

  it.each([
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example',
    'javascript:alert(1)',
    'w/hr',
    '',
    null,
    undefined,
    '/a\nb',
  ])('rejects %s', (input) => {
    expect(safeNextPath(input as string | null | undefined, '/fallback')).toBe('/fallback')
  })
})

describe('loginPath', () => {
  it('adds next and error only when useful', () => {
    expect(loginPath()).toBe('/login')
    expect(loginPath('/')).toBe('/login')
    expect(loginPath('/w/hr')).toBe('/login?next=%2Fw%2Fhr')
    expect(loginPath('https://evil.example')).toBe('/login')
    expect(loginPath(null, 'oauth')).toBe('/login?error=oauth')
  })
})

describe('dashboardOrigin and authCallbackUrl', () => {
  it('uses http only under next dev', () => {
    expect(dashboardOrigin({ DASHBOARD_HOST: 'survey.localhost:3000', NODE_ENV: 'development' })).toBe(
      'http://survey.localhost:3000',
    )
    expect(dashboardOrigin({ DASHBOARD_HOST: 'survey.example.org', NODE_ENV: 'production' })).toBe(
      'https://survey.example.org',
    )
    expect(() => dashboardOrigin({ NODE_ENV: 'production' })).toThrow()
  })

  it('points at /api/auth/callback with a safe next', () => {
    expect(authCallbackUrl('/w/hr', 'https://survey.example.org')).toBe(
      'https://survey.example.org/api/auth/callback?next=%2Fw%2Fhr',
    )
    expect(authCallbackUrl('//evil', 'https://survey.example.org')).toBe('https://survey.example.org/api/auth/callback')
  })
})
