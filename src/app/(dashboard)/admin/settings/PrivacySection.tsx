import { getPlatformSettings } from '@/lib/db/admin'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { PrivacyNoticeEditor } from '@/components/admin/PrivacyNoticeEditor'
import { savePrivacyNotice } from '../actions'
import type { AdminCtx } from '../users/types'

/** Organization privacy notice, shown at /privacy on the public host (doc 05 section 7.1, doc 02 section 9). */
export async function PrivacySection({ ctx }: { ctx: AdminCtx }) {
  const { supabase } = ctx
  const settings = await getPlatformSettings(supabase)
  const s = settings.ok ? settings.data : null
  return (
    <>
      <h2 className="sr-only">Organization privacy notice</h2>
      <p className="mb-4 text-sm text-muted">Every public survey footer links to this notice. Saving updates the public page at once.</p>
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
