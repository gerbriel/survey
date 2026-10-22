import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/lib/auth'
import { readAdminTab } from '@/components/dashboard/nav-links'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SectionTabs } from '@/components/admin/SectionTabs'
import { AuditSection } from './AuditSection'
import { PrivacySection } from './PrivacySection'

export const metadata: Metadata = { title: 'Settings' }

const TABS = [
  { key: 'privacy', label: 'Organization privacy notice' },
  { key: 'audit', label: 'Platform audit log' },
] as const

/** Platform settings (R21): the organization privacy notice and the platform audit log. /admin/privacy and /admin/audit redirect here. */
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePlatformAdmin()
  const sp = await searchParams
  const tab = readAdminTab(sp, TABS)
  return (
    <>
      <PageHeader title="Settings" description="Deployment-wide settings and the record of every platform admin action." />
      <SectionTabs path="/admin/settings" tabs={TABS} active={tab} label="Settings sections" />
      {tab === 'privacy' ? <PrivacySection ctx={ctx} /> : null}
      {tab === 'audit' ? <AuditSection ctx={ctx} sp={sp} /> : null}
    </>
  )
}
