import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SharedReportView } from '@/components/reports/SharedReportView'
import { loadSharedReport, shareCookieName, shareCookieSecret, shareGate, unsealPassword } from '@/lib/analytics/share'
import { unlockSharedReport } from './actions'

/**
 * Public read-only report (doc 04 section 5.4, R15) on PUBLIC_HOST. Every
 * load calls report_share_gate (which also counts the view), then
 * shared_report_payload, through src/lib/analytics/share.ts; unknown, revoked
 * and expired tokens get the same 404. Aggregates only, no
 * pixels, no member session, noindex and no referrer.
 */
export const metadata: Metadata = {
  title: 'Shared report',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

type Props = {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SharedReportPage({ params, searchParams }: Props) {
  const { token } = await params
  const sealed = (await cookies()).get(shareCookieName(token))?.value
  const password = sealed ? unsealPassword(sealed, token, shareCookieSecret()) : null
  const gate = await shareGate(token, password)
  if (gate === 'not_found') notFound()
  if (gate === 'needs_password') {
    return <PasswordPrompt token={token} error={password ? 'wrong' : (await searchParams).e} />
  }
  const payload = await loadSharedReport(token, password)
  if (!payload) notFound()
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <SharedReportView payload={payload} />
    </main>
  )
}

function PasswordPrompt({ token, error }: { token: string; error?: string | string[] }) {
  const msg = error === 'rate' ? 'Too many attempts. Wait 15 minutes and try again.' : error === 'wrong' ? 'That password is not right.' : null
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-fg">This report is protected</h1>
      <form action={unlockSharedReport.bind(null, token)} className="flex flex-col gap-3">
        <Input label="Password" name="password" type="password" required autoComplete="current-password" error={msg ?? undefined} />
        <Button type="submit">View report</Button>
      </form>
    </main>
  )
}
