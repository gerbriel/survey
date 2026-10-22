import { describe, expect, it } from 'vitest'
import { ADMIN_NAV, activeLink, adminTabHref, isActivePath, privacyToolsPath, readAdminTab, resultsTabs, workspaceNav } from '../nav-links'
import { settingsLinks } from '../SettingsTabs'

describe('workspace shell nav contract', () => {
  it('has exactly Dashboard, Surveys, Results and Settings (R22)', () => {
    const nav = workspaceNav('sales-team')
    expect(nav.map((l) => l.label)).toEqual(['Dashboard', 'Surveys', 'Results', 'Settings'])
    expect(nav.map((l) => l.href)).toEqual([
      '/w/sales-team/dashboard',
      '/w/sales-team/surveys',
      '/w/sales-team/results',
      '/w/sales-team/settings',
    ])
  })

  it('marks Results active for results, compare and contacts, Settings for privacy tools', () => {
    const nav = workspaceNav('a')
    const at = (p: string) => activeLink(p, nav)?.label
    expect(at('/w/a/results')).toBe('Results')
    expect(at('/w/a/compare/export')).toBe('Results')
    expect(at('/w/a/contacts/123')).toBe('Results')
    expect(at('/w/a/contacts-old')).toBeUndefined()
    expect(at('/w/a/settings/privacy-tools')).toBe('Settings')
    expect(at('/w/a/surveys/1/results')).toBe('Surveys')
    expect(at('/w/a/dashboard')).toBe('Dashboard')
  })

  it('marks a section active for itself and its children only', () => {
    expect(isActivePath('/w/a/surveys/123/edit', '/w/a/surveys')).toBe(true)
    expect(isActivePath('/w/a/surveys', '/w/a/surveys')).toBe(true)
    expect(isActivePath('/w/a/surveys-old', '/w/a/surveys')).toBe(false)
    expect(isActivePath(null, '/w/a')).toBe(false)
  })

  it('filters settings sections by role', () => {
    expect(settingsLinks('a', 'viewer').map((l) => l.segment)).toEqual(['general', 'images', 'members', 'privacy', 'limits'])
    expect(settingsLinks('a', 'editor').map((l) => l.segment)).toEqual(['general', 'images', 'members', 'pixels', 'privacy', 'privacy-tools', 'limits'])
    expect(settingsLinks('a', 'admin')).toHaveLength(9)
  })

  it('keeps Privacy and Privacy tools apart in the settings tabs', () => {
    const links = settingsLinks('a', 'admin')
    expect(activeLink('/w/a/settings/privacy-tools/export', links)?.segment).toBe('privacy-tools')
    expect(activeLink('/w/a/settings/privacy', links)?.segment).toBe('privacy')
  })
})

describe('results tabs (R22)', () => {
  const tabs = resultsTabs('sales-team')

  it('are Responses, Compare and Contacts at unchanged URLs', () => {
    expect(tabs.map((t) => [t.label, t.href])).toEqual([
      ['Responses', '/w/sales-team/results'],
      ['Compare', '/w/sales-team/compare'],
      ['Contacts', '/w/sales-team/contacts'],
    ])
  })

  it('follow the pathname, nested routes included', () => {
    const at = (p: string) => activeLink(p, tabs)?.label
    expect(at('/w/sales-team/results')).toBe('Responses')
    expect(at('/w/sales-team/results/export')).toBe('Responses')
    expect(at('/w/sales-team/compare/export')).toBe('Compare')
    expect(at('/w/sales-team/contacts/abc')).toBe('Contacts')
    expect(at('/w/sales-team/contacts/duplicates')).toBe('Contacts')
    expect(at('/w/sales-team/surveys')).toBeUndefined()
    expect(activeLink(null, tabs)).toBeUndefined()
  })
})

describe('privacy tools path (R22)', () => {
  it('points at settings and keeps the sub path and query', () => {
    expect(privacyToolsPath('a')).toBe('/w/a/settings/privacy-tools')
    expect(privacyToolsPath('a', 'export', '?contact=1')).toBe('/w/a/settings/privacy-tools/export?contact=1')
    expect(privacyToolsPath('a', '', 'q=x')).toBe('/w/a/settings/privacy-tools?q=x')
    expect(privacyToolsPath('a', '', '?')).toBe('/w/a/settings/privacy-tools')
  })
})

describe('platform admin nav (R21)', () => {
  it('has exactly Workspaces, Users and Settings', () => {
    expect(ADMIN_NAV.map((l) => l.href)).toEqual(['/admin/workspaces', '/admin/users', '/admin/settings'])
  })

  const tabs = [
    { key: 'users', label: 'Users' },
    { key: 'invites', label: 'Platform invites' },
  ] as const

  it('reads a known tab and falls back to the first', () => {
    expect(readAdminTab({ tab: 'invites' }, tabs)).toBe('invites')
    expect(readAdminTab({ tab: 'nope' }, tabs)).toBe('users')
    expect(readAdminTab({}, tabs)).toBe('users')
    expect(readAdminTab({ tab: ['invites'] }, tabs)).toBe('users')
  })

  it('links the default tab without a query', () => {
    expect(adminTabHref('/admin/users', 'users', tabs)).toBe('/admin/users')
    expect(adminTabHref('/admin/users', 'invites', tabs)).toBe('/admin/users?tab=invites')
  })
})
