import type { ReactNode } from 'react'
import { ClosedScreen } from '@/components/survey/renderer'
import { OpensAt } from './OpensAt'

/**
 * Non-survey public screens (doc 02 section 3): not found, scheduled,
 * closed. Neutral styling from the shared tokens, workspace logo when set,
 * and the public footer. No definition is sent for these states.
 */

export const DEFAULT_CLOSED_MESSAGE = 'This survey is no longer accepting responses.'

export function PublicFrame({ logoUrl, children, footer }: { logoUrl?: string | null; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted text-fg">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public-assets Storage URL.
          <img src={logoUrl} alt="" className="h-12 w-auto self-start object-contain" />
        ) : null}
        <main className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-sm sm:p-8">{children}</main>
        {footer ? <footer className="mt-auto text-muted">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function NotFoundScreen({ footer }: { footer?: ReactNode }) {
  return (
    <PublicFrame footer={footer}>
      <h1 className="text-xl font-semibold">Survey not found</h1>
      <p className="text-muted">Check the link you were given. It may be mistyped or no longer available.</p>
    </PublicFrame>
  )
}

/** Plain text closed message, max 1,000 chars, line breaks kept. */
export function ClosedStateScreen({
  title,
  message,
  logoUrl,
  footer,
}: {
  title: string
  message: string | null
  logoUrl?: string | null
  footer?: ReactNode
}) {
  return (
    <PublicFrame logoUrl={logoUrl} footer={footer}>
      <p className="text-sm text-muted">{title}</p>
      <ClosedScreen message={<p className="whitespace-pre-line">{(message || DEFAULT_CLOSED_MESSAGE).slice(0, 1000)}</p>} />
    </PublicFrame>
  )
}

export function ScheduledScreen({
  title,
  opensAt,
  logoUrl,
  footer,
}: {
  title: string
  opensAt: string | null
  logoUrl?: string | null
  footer?: ReactNode
}) {
  return (
    <PublicFrame logoUrl={logoUrl} footer={footer}>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p>{opensAt ? <OpensAt iso={opensAt} /> : 'This survey is not open yet.'}</p>
    </PublicFrame>
  )
}
