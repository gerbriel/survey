'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'

/**
 * Consent UI (doc 02 section 7.2, R7). opt_in: Accept and Decline with
 * equal weight; nothing loads until Accept. notice: informational, dismiss
 * only; pixels already load. Both link the privacy notice in a new tab so a
 * click never loses survey progress.
 */
export function ConsentBanner({
  kind,
  workspaceName,
  onAccept,
  onDecline,
  onDismiss,
}: {
  kind: 'opt_in' | 'notice'
  workspaceName?: string | null
  onAccept?: () => void
  onDecline?: () => void
  onDismiss?: () => void
}) {
  return (
    <section
      aria-label="Analytics and tracking"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4 text-fg shadow-lg"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {kind === 'opt_in'
            ? `${workspaceName || 'The survey owner'} would like to use analytics and advertising tools on this survey. They never receive your answers.`
            : 'This survey uses analytics tools. They never receive your answers.'}{' '}
          <Link href="/privacy" prefetch={false} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Privacy notice<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          {kind === 'opt_in' ? (
            <>
              <Button variant="secondary" className="min-h-11 flex-1 sm:flex-none" onClick={onDecline}>
                Decline
              </Button>
              <Button variant="secondary" className="min-h-11 flex-1 sm:flex-none" onClick={onAccept}>
                Accept
              </Button>
            </>
          ) : (
            <Button variant="secondary" className="min-h-11" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
