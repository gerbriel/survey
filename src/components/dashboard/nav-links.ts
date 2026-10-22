/**
 * Workspace navigation (the shell contract, R22): Dashboard, Surveys,
 * Results and Settings. Results is a tab group over /results, /compare and
 * /contacts (route group `(results)`, URLs unchanged); Settings holds the
 * workspace sections plus Privacy tools. Pure, unit tested.
 *
 * `match` lists extra path prefixes that also mark a link active.
 */
export type NavLink = { href: string; label: string; segment: string; match?: string[] }

function wsBase(slug: string): string {
  return `/w/${encodeURIComponent(slug)}`
}

/** Tabs of the Results area: Responses, Compare, Contacts. */
export function resultsTabs(slug: string): NavLink[] {
  const base = wsBase(slug)
  return [
    { href: `${base}/results`, label: 'Responses', segment: 'results' },
    { href: `${base}/compare`, label: 'Compare', segment: 'compare' },
    { href: `${base}/contacts`, label: 'Contacts', segment: 'contacts' },
  ]
}

export function workspaceNav(slug: string): NavLink[] {
  const base = wsBase(slug)
  return [
    { href: `${base}/dashboard`, label: 'Dashboard', segment: 'dashboard' },
    { href: `${base}/surveys`, label: 'Surveys', segment: 'surveys' },
    { href: `${base}/results`, label: 'Results', segment: 'results', match: [`${base}/compare`, `${base}/contacts`] },
    { href: `${base}/settings`, label: 'Settings', segment: 'settings' },
  ]
}

/** True when `pathname` is `href` or below it. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** True when `pathname` is under the link's href or any of its `match` prefixes. */
export function isActiveLink(pathname: string | null, link: NavLink): boolean {
  return [link.href, ...(link.match ?? [])].some((h) => isActivePath(pathname, h))
}

/** The one active link for `pathname`, or undefined. */
export function activeLink(pathname: string | null, links: readonly NavLink[]): NavLink | undefined {
  return links.find((l) => isActiveLink(pathname, l))
}

/**
 * Where an old /w/[slug]/privacy-tools URL now lives (R22). Keeps the sub
 * path and the query string so bookmarked lookups and export links work.
 * Decision: the query string is carried over (for example `?q=` and `?contact=`).
 */
export function privacyToolsPath(slug: string, sub = '', search = ''): string {
  const q = search && !search.startsWith('?') ? `?${search}` : search
  return `${wsBase(slug)}/settings/privacy-tools${sub ? `/${sub}` : ''}${q === '?' ? '' : q}`
}

/** Platform admin navigation (R21): exactly these three sections. */
export const ADMIN_NAV: NavLink[] = [
  { href: '/admin/workspaces', label: 'Workspaces', segment: 'workspaces' },
  { href: '/admin/users', label: 'Users', segment: 'users' },
  { href: '/admin/settings', label: 'Settings', segment: 'settings' },
]

/** Section tabs inside an admin page, chosen by `?tab=`. The first entry is the default. */
export type AdminTab<K extends string = string> = { key: K; label: string }

export function readAdminTab<K extends string>(
  sp: Record<string, string | string[] | undefined>,
  tabs: readonly AdminTab<K>[],
): K {
  const raw = typeof sp.tab === 'string' ? sp.tab : ''
  return (tabs.find((t) => t.key === raw) ?? tabs[0]!).key
}

export function adminTabHref(path: string, key: string, tabs: readonly AdminTab[]): string {
  return tabs[0]?.key === key ? path : `${path}?tab=${encodeURIComponent(key)}`
}
