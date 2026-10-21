import { requireMember } from '@/lib/auth'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SettingsTabs } from '@/components/dashboard/SettingsTabs'

/** Settings frame: title and section links filtered by role (doc 05 section 2.3). UX only. */
export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { role, workspace } = await requireMember(slug)
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" description={workspace.name} />
      <SettingsTabs slug={workspace.slug} role={role} />
      {children}
    </div>
  )
}
