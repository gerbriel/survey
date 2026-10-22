import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/lib/auth'
import { readAdminTab } from '@/components/dashboard/nav-links'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SectionTabs } from '@/components/admin/SectionTabs'
import { InvitesSection } from './InvitesSection'
import { RequestsSection } from './RequestsSection'
import { UsersSection } from './UsersSection'

export const metadata: Metadata = { title: 'Users' }

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'invites', label: 'Platform invites' },
  { key: 'requests', label: 'Requests' },
] as const

/**
 * Users, platform invites and access or workspace requests on one page (R21).
 * `?tab=` picks the section; /admin/invites and /admin/requests redirect here.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePlatformAdmin()
  const sp = await searchParams
  const tab = readAdminTab(sp, TABS)
  return (
    <>
      <PageHeader title="Users" description="People, the invites that let them in, and their requests for access or a workspace." />
      <SectionTabs path="/admin/users" tabs={TABS} active={tab} label="User sections" />
      {tab === 'users' ? <UsersSection ctx={ctx} sp={sp} /> : null}
      {tab === 'invites' ? <InvitesSection ctx={ctx} /> : null}
      {tab === 'requests' ? <RequestsSection ctx={ctx} sp={sp} /> : null}
    </>
  )
}
