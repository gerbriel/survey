import type { WorkspaceRole } from '@/types/db-helpers'
import { roleAtLeast } from '@/lib/auth/roles'
import { SectionTabs } from './SectionTabs'
import type { NavLink } from './nav-links'

/** Settings sections and the minimum role that sees each one (doc 05 section 2.3). */
export const SETTINGS_SECTIONS: Array<{ segment: string; label: string; minRole: WorkspaceRole }> = [
  { segment: 'general', label: 'General', minRole: 'viewer' },
  { segment: 'images', label: 'Images', minRole: 'viewer' },
  { segment: 'members', label: 'Members', minRole: 'viewer' },
  { segment: 'invites', label: 'Invites', minRole: 'admin' },
  { segment: 'pixels', label: 'Tracking pixels', minRole: 'editor' },
  { segment: 'privacy', label: 'Privacy', minRole: 'viewer' },
  // Decision: Privacy tools keeps its old minimum role, editor (lookup and export; erase is admin only).
  { segment: 'privacy-tools', label: 'Privacy tools', minRole: 'editor' },
  { segment: 'limits', label: 'Limits', minRole: 'viewer' },
  { segment: 'activity', label: 'Activity', minRole: 'admin' },
]

export function settingsLinks(slug: string, role: WorkspaceRole): NavLink[] {
  return SETTINGS_SECTIONS.filter((s) => roleAtLeast(role, s.minRole)).map((s) => ({
    segment: s.segment,
    label: s.label,
    href: `/w/${encodeURIComponent(slug)}/settings/${s.segment}`,
  }))
}

/** Tab-like link row for the settings area. Links, not ARIA tabs, because each section is its own page. */
export function SettingsTabs({ slug, role }: { slug: string; role: WorkspaceRole }) {
  return <SectionTabs links={settingsLinks(slug, role)} label="Settings sections" />
}
