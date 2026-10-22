import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentWorkspace, requirePlatformAdmin } from '@/lib/auth'
import { Nav } from '@/components/dashboard/Nav'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { WorkspaceSwitcher } from '@/components/dashboard/WorkspaceSwitcher'
import { ADMIN_NAV } from '@/components/dashboard/nav-links'
import { signOut } from '../login/actions'

export const metadata: Metadata = { title: { default: 'Platform admin', template: '%s | Platform admin' } }

/**
 * /admin chrome. requirePlatformAdmin is UX only (404 for everyone else);
 * every admin RPC and policy checks is_platform_admin() in SQL. The header
 * switcher lists the admin's own memberships and lands on each workspace's
 * surveys; "Back" returns to the last workspace in one click.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()
  const current = await getCurrentWorkspace()
  const workspaces = (current?.memberships ?? []).map((m) => ({
    slug: m.workspace.slug,
    name: m.workspace.name,
    role: m.role,
    archived: m.workspace.archived_at !== null,
  }))
  const back = current ? `/w/${encodeURIComponent(current.workspace.slug)}/surveys` : '/'
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-sm font-semibold">
              Survey platform admin
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <WorkspaceSwitcher workspaces={workspaces} label="Open a workspace" hrefSuffix="/surveys" />
            <Link href={back} className="text-sm text-muted hover:text-fg hover:underline">
              Back{current ? <span className="sr-only"> to {current.workspace.name}</span> : null}
            </Link>
            <SignOutButton action={signOut} />
          </div>
        </div>
        <div className="px-4 pb-2 sm:px-6 lg:px-8">
          <Nav links={ADMIN_NAV} label="Platform admin" />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
