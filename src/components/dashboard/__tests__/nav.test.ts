import { describe, expect, it } from 'vitest'
import { isActivePath, workspaceNav } from '../nav-links'
import { settingsLinks } from '../SettingsTabs'

describe('workspace shell nav contract', () => {
  it('links every Phase 2 section under /w/[slug]', () => {
    expect(workspaceNav('sales-team').map((l) => l.href)).toEqual([
      '/w/sales-team/dashboard',
      '/w/sales-team/surveys',
      '/w/sales-team/contacts',
      '/w/sales-team/privacy-tools',
      '/w/sales-team/settings',
    ])
  })

  it('marks a section active for itself and its children only', () => {
    expect(isActivePath('/w/a/surveys/123/edit', '/w/a/surveys')).toBe(true)
    expect(isActivePath('/w/a/surveys', '/w/a/surveys')).toBe(true)
    expect(isActivePath('/w/a/surveys-old', '/w/a/surveys')).toBe(false)
    expect(isActivePath(null, '/w/a')).toBe(false)
  })

  it('filters settings sections by role', () => {
    expect(settingsLinks('a', 'viewer').map((l) => l.segment)).toEqual(['general', 'members', 'privacy', 'limits'])
    expect(settingsLinks('a', 'editor').map((l) => l.segment)).toEqual(['general', 'members', 'pixels', 'privacy', 'limits'])
    expect(settingsLinks('a', 'admin')).toHaveLength(7)
  })
})
