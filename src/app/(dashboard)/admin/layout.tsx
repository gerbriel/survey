import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { countOpenAbuseReports } from '@/lib/admin/db/platform'
import { Nav } from '@/components/dashboard/Nav'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { signOut } from '../login/actions'

export const metadata: Metadata = { title: { default: 'Platform admin', template: '%s | Platform admin' } }

/**
 * /admin chrome. requirePlatformAdmin is UX only (404 for everyone else);
 * every admin RPC and policy checks is_platform_admin() in SQL.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin()
  const open = await countOpenAbuseReports(ctx.supabase)
  const openCount = open.ok ? open.data : 0
  const links = [
    { href: '/admin/workspaces', label: 'Workspaces', segment: 'workspaces' },
    { href: '/admin/invites', label: 'Invites', segment: 'invites' },
    { href: '/admin/requests', label: 'Requests', segment: 'requests' },
    { href: '/admin/users', label: 'Users', segment: 'users' },
    { href: '/admin/reports', label: openCount ? `Abuse reports (${openCount} open)` : 'Abuse reports', segment: 'reports' },
    { href: '/admin/privacy', label: 'Privacy notice', segment: 'privacy' },
    { href: '/admin/audit', label: 'Audit log', segment: 'audit' },
  ]
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-sm font-semibold">
              Survey platform admin
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-muted hover:text-fg hover:underline">
              Back to workspaces
            </Link>
            <SignOutButton action={signOut} />
          </div>
        </div>
        <div className="px-4 pb-2 sm:px-6 lg:px-8">
          <Nav links={links} label="Platform admin" />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
