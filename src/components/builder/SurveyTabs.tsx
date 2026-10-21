'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx, focusRing } from '@/components/ui/cx'

/**
 * Survey sub-navigation. Responses (2D), Analytics and Reports (2E) are
 * other modules' routes, linked by path only.
 */
export function SurveyTabs({ base }: { base: string }) {
  const path = usePathname()
  const tabs = [
    { href: `${base}/edit`, label: 'Edit' },
    { href: `${base}/share`, label: 'Share' },
    { href: `${base}/settings`, label: 'Settings' },
    { href: `${base}/responses`, label: 'Responses' },
    { href: `${base}/analytics`, label: 'Analytics' },
    { href: `${base}/reports`, label: 'Reports' },
  ]
  return (
    <nav aria-label="Survey sections" className="flex gap-1 overflow-x-auto border-b border-border px-4">
      {tabs.map((t) => {
        const active = path === t.href || path.startsWith(`${t.href}/`)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', focusRing, active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
