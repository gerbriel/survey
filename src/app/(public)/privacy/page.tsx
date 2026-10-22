import type { Metadata } from 'next'
import { getPrivacyNotice } from '@/lib/public/privacy'
import { Markdown } from '@/components/public/Markdown'
import { PublicFooter } from '@/components/public/PublicFooter'
import { PublicFrame } from '@/components/public/StateScreens'

/** Organization privacy notice (doc 02 section 9, doc 05). No pixels on this page. */

export const metadata: Metadata = { title: 'Privacy notice', robots: { index: false, follow: false } }

export default async function PrivacyPage() {
  const notice = await getPrivacyNotice()
  const text = notice?.markdown.trim() ?? ''
  return (
    <PublicFrame footer={<PublicFooter newTab={false} />}>
      <h1 className="text-2xl font-bold">Privacy notice</h1>
      {text ? (
        <Markdown text={text} />
      ) : (
        <p className="text-muted">The privacy notice is being prepared. Please check back soon.</p>
      )}
      {notice?.updatedAt && text ? (
        <p className="text-sm text-muted">
          Last updated <time dateTime={notice.updatedAt}>{notice.updatedAt.slice(0, 10)}</time>
        </p>
      ) : null}
    </PublicFrame>
  )
}
