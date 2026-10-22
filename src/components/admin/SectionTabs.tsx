import Link from 'next/link'
import { cx, focusRing } from '@/components/ui/cx'
import { adminTabHref, type AdminTab } from '@/components/dashboard/nav-links'

/**
 * Section links inside an admin page (`?tab=`). Plain links with
 * aria-current, not ARIA tabs: each section is its own URL, works without
 * JavaScript, and Tab plus Enter reach every one.
 */
export function SectionTabs({ path, tabs, active, label }: { path: string; tabs: readonly AdminTab[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto border-b border-border pb-2">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={adminTabHref(path, t.key, tabs)}
              aria-current={t.key === active ? 'page' : undefined}
              className={cx(
                'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium',
                focusRing,
                t.key === active ? 'bg-surface-muted text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg',
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
