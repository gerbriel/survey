import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { PrivacyForm } from '@/components/settings/PrivacyForm'
import { updatePrivacy } from '../actions'

export const metadata: Metadata = { title: 'Privacy settings' }

/** Doc 05 section 5.5. Respondent deletion tools live in Privacy tools (Phase 2E). */
export default async function PrivacySettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, role } = await requireMember(slug)
  const mode = workspace.pixel_consent_mode as 'banner' | 'notice' | 'in_form'
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Privacy</h2>
      <PrivacyForm
        action={updatePrivacy.bind(null, workspace.slug)}
        canEdit={memberCan(role, 'admin', workspace)}
        values={{
          storeIp: workspace.store_ip,
          retentionDays: workspace.retention_days,
          defaultCountry: workspace.default_country,
          privacyNoticeUrl: workspace.privacy_notice_url ?? '',
          consentDefaultText: workspace.consent_default_text ?? '',
          pixelConsentMode: mode,
          noticeAcknowledged: workspace.pixel_notice_ack_at !== null,
          noticeAckLine: workspace.pixel_notice_ack_at ? `Acknowledged ${formatDateTime(workspace.pixel_notice_ack_at)}.` : null,
        }}
      />
    </div>
  )
}
