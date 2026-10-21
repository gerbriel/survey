'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx, focusRing } from '@/components/ui/cx'
import { isActivePath, type NavLink } from './nav-links'

/**
 * Horizontal link list with aria-current on the active section. Scrolls
 * sideways on narrow screens instead of wrapping. Used by the workspace
 * shell, the settings tabs and the /admin layout.
 */
export function Nav({ links, label, className }: { links: NavLink[]; label: string; className?: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label={label} className={cx('-mx-1 overflow-x-auto', className)}>
      <ul className="flex min-w-max gap-1 px-1">
        {links.map((l) => {
          const active = isActivePath(pathname, l.href)
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium',
                  focusRing,
                  active ? 'bg-surface-muted text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg',
                )}
              >
                {l.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
