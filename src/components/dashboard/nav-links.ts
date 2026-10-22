/**
 * Workspace navigation (the shell contract). Pages owned by other phases slot
 * in at these paths: dashboard (2E), surveys (2B, 2D, 2E under it),
 * contacts (2D), privacy-tools (2E), settings (2A). Pure, unit tested.
 */
export type NavLink = { href: string; label: string; segment: string }

export function workspaceNav(slug: string): NavLink[] {
  const base = `/w/${encodeURIComponent(slug)}`
  return [
    { href: `${base}/dashboard`, label: 'Dashboard', segment: 'dashboard' },
    { href: `${base}/surveys`, label: 'Surveys', segment: 'surveys' },
    { href: `${base}/results`, label: 'Results', segment: 'results' },
    { href: `${base}/compare`, label: 'Compare', segment: 'compare' },
    { href: `${base}/contacts`, label: 'Contacts', segment: 'contacts' },
    { href: `${base}/privacy-tools`, label: 'Privacy tools', segment: 'privacy-tools' },
    { href: `${base}/settings`, label: 'Settings', segment: 'settings' },
  ]
}

/** True when `pathname` is `href` or below it. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}
