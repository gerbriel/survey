import type { Metadata } from 'next'
import { PublicFooter } from '@/components/public/PublicFooter'
import { PublicFrame } from '@/components/public/StateScreens'
import { ReportForm } from './ReportForm'

/** Report abuse (doc 02 section 9.1). No pixels. Never says whether the slug exists. */

export const metadata: Metadata = { title: 'Report abuse', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ReportPage({ searchParams }: Props) {
  const sp = await searchParams
  const raw = Array.isArray(sp.s) ? sp.s[0] : sp.s
  const slug = raw && /^[a-z0-9][a-z0-9-]{0,98}$/i.test(raw) ? raw.toLowerCase() : ''
  return (
    <PublicFrame footer={<PublicFooter newTab={false} showReport={false} />}>
      <h1 className="text-2xl font-bold">Report abuse</h1>
      <p className="text-muted">
        Tell us if a survey on this site is phishing, impersonating someone, collecting sensitive information it should not, or is otherwise abusive.
      </p>
      <ReportForm slug={slug} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined} />
    </PublicFrame>
  )
}
