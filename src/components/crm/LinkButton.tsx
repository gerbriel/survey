import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx, focusRing } from '@/components/ui'

/** A link styled like the ui Button (secondary, small), so no button nests in an anchor. */
export function LinkButton({
  href,
  children,
  variant = 'secondary',
  className,
  prefetch,
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
  className?: string
  prefetch?: boolean
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition',
        variant === 'primary'
          ? 'bg-accent text-accent-fg hover:opacity-90'
          : 'border border-border bg-surface text-fg hover:bg-surface-muted',
        focusRing,
        className,
      )}
    >
      {children}
    </Link>
  )
}
