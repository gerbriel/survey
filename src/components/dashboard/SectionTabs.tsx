import { cx } from '@/components/ui/cx'
import { Nav } from './Nav'
import type { NavLink } from './nav-links'

/**
 * In-page section tabs: a row of links under a bordered rule, the active one
 * marked with aria-current from the pathname. Links, not ARIA tabs, because
 * each section is its own page. Used by the settings area and the Results
 * area (Responses, Compare, Contacts).
 */
export function SectionTabs({ links, label, className = 'mb-6' }: { links: NavLink[]; label: string; /** Outer spacing, default mb-6. */ className?: string }) {
  return <Nav links={links} label={label} className={cx('border-b border-border pb-2', className)} />
}
