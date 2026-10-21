import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/lib/auth'
import { getPlatformSettings } from '@/lib/db/admin'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { PrivacyNoticeEditor } from '@/components/admin/PrivacyNoticeEditor'
import { savePrivacyNotice } from '../actions'

export const metadata: Metadata = { title: 'Privacy notice' }

/** Organization privacy notice, shown at /privacy on the public host (doc 05 section 7.1, doc 02 section 9). */
export default async function AdminPrivacyPage() {
  const { supabase } = await requirePlatformAdmin()
  const settings = await getPlatformSettings(supabase)
  const s = settings.ok ? settings.data : null
  return (
    <>
      <PageHeader
        title="Privacy notice"
        description="Every public survey footer links to this notice. Saving updates the public page at once."
      />
      {s?.updated_at ? <p className="mb-4 text-xs text-muted">Last saved {formatDateTime(s.updated_at)}.</p> : null}
      {!settings.ok ? (
        <p role="alert" className="text-sm text-danger">
          {settings.error.message}
        </p>
      ) : (
        <PrivacyNoticeEditor action={savePrivacyNotice} initial={s?.privacy_notice_md ?? ''} />
      )}
    </>
  )
}
