import { describe, expect, it } from 'vitest'
import {
  classifyHost,
  isDashboardPathAllowed,
  isPublicPathAllowed,
  normalizeHost,
  publicRedirectTarget,
} from '@/lib/hosts'

const env = { DASHBOARD_HOST: 'survey.localhost:3000', PUBLIC_HOST: 's.localhost:3000' }

describe('host routing', () => {
  it('normalizes case and port', () => {
    expect(normalizeHost('S.Localhost:3000')).toBe('s.localhost')
    expect(normalizeHost(null)).toBe('')
  })

  it('classifies the two hostnames and rejects others', () => {
    expect(classifyHost('s.localhost:3000', env)).toBe('public')
    expect(classifyHost('survey.localhost', env)).toBe('dashboard')
    expect(classifyHost('evil.example', env)).toBe('unknown')
    expect(classifyHost('localhost:3000', env)).toBe('unknown')
  })

  it('public host allows survey keys and public APIs only', () => {
    expect(isPublicPathAllowed('/')).toBe(true)
    expect(isPublicPathAllowed('/abc123xyz0')).toBe(true)
    expect(isPublicPathAllowed('/report')).toBe(true)
    expect(isPublicPathAllowed('/api/public/submit')).toBe(true)
    expect(isPublicPathAllowed('/r/tok_123')).toBe(true)
    expect(isPublicPathAllowed('/login')).toBe(false)
    expect(isPublicPathAllowed('/admin')).toBe(false)
    expect(isPublicPathAllowed('/w/sales/surveys')).toBe(false)
    expect(isPublicPathAllowed('/api/cron/retention')).toBe(false)
    expect(isPublicPathAllowed('/_home')).toBe(false)
  })

  it('dashboard host refuses public APIs and public pages', () => {
    expect(isDashboardPathAllowed('/', { dev: false })).toBe(true)
    expect(isDashboardPathAllowed('/w/sales', { dev: false })).toBe(true)
    expect(isDashboardPathAllowed('/api/cron/retention', { dev: false })).toBe(true)
    expect(isDashboardPathAllowed('/api/public/submit', { dev: false })).toBe(false)
    expect(isDashboardPathAllowed('/abc123xyz0', { dev: false })).toBe(false)
    expect(isDashboardPathAllowed('/dev/renderer', { dev: false })).toBe(false)
    expect(isDashboardPathAllowed('/dev/renderer', { dev: true })).toBe(true)
  })

  it('redirects /s/{key} to the public host keeping the query string', () => {
    expect(publicRedirectTarget('/s/abc123xyz0', '?t=x', 's.example.org', 'https')).toBe(
      'https://s.example.org/abc123xyz0?t=x',
    )
    expect(publicRedirectTarget('/s/', '', 's.example.org', 'https')).toBeNull()
    expect(publicRedirectTarget('/w/x', '', 's.example.org', 'https')).toBeNull()
  })
})
