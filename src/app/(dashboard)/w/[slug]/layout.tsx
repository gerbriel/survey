import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireMember, requireUser } from '@/lib/auth'
import { getWorkspaceById, getWorkspaceBySlug, listMemberships } from '@/lib/db/workspaces'
import { setLastWorkspace } from '@/lib/db/profiles'
import { getSlugHistory } from '@/lib/admin/db/workspace'
import { slugRedirectActive } from '@/lib/admin/lifecycle'
import { Nav } from '@/components/dashboard/Nav'
import { RoleBadge } from '@/components/dashboard/RoleBadge'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { WorkspaceSwitcher } from '@/components/dashboard/WorkspaceSwitcher'
import { workspaceNav } from '@/components/dashboard/nav-links'
import { signOut } from '../../login/actions'

/**
 * Workspace shell (doc 05 section 4.4). SHELL CONTRACT for every page under
 * /w/[slug]: this layout renders the top bar, the section nav and a
 * full-width <main id="main"> with page padding. Pages render their content
 * only (no <main>, no outer padding), start with <PageHeader> from
 * src/components/dashboard/PageHeader, and pick their own max width.
 * Pages still call requireMember(slug, minRole) themselves for their own
 * role and data needs; getAuthContext is cached per request.
 *
 * The guard here is UX ONLY: it decides what to render. RLS and the SQL
 * functions are the authorization for every read and write below it.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = await requireUser({ next: `/w/${slug}` })

  // Renamed workspace: the old slug redirects for 30 days (doc 05 section 1.2).
  const live = await getWorkspaceBySlug(ctx.supabase, { slug })
  if (live.ok && !live.data) {
    const hist = await getSlugHistory(ctx.supabase, { slug })
    if (hist.ok && hist.data?.workspace_id && slugRedirectActive(hist.data.released_at)) {
      const ws = await getWorkspaceById(ctx.supabase, { workspaceId: hist.data.workspace_id })
      if (ws.ok && ws.data && !ws.data.deleted_at) redirect(`/w/${encodeURIComponent(ws.data.slug)}`)
    }
    notFound()
  }

  const { workspace, role, profile, supabase, user } = await requireMember(slug, 'viewer')

  // Where `/` lands next time. Written only when it changes.
  if (profile && profile.last_workspace_id !== workspace.id) {
    await setLastWorkspace(supabase, { userId: user.id, workspaceId: workspace.id })
  }

  const memberships = await listMemberships(supabase, { userId: user.id })
  const switcher = (memberships.ok ? memberships.data : []).map((m) => ({
    slug: m.workspace.slug,
    name: m.workspace.name,
    role: m.role,
    archived: m.workspace.archived_at !== null,
  }))
  const current = { slug: workspace.slug, name: workspace.name, role, archived: workspace.archived_at !== null }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="text-sm font-semibold text-fg">
              Survey
            </Link>
            <WorkspaceSwitcher current={current} workspaces={switcher.length ? switcher : [current]} />
            <RoleBadge role={role} />
          </div>
          <div className="flex items-center gap-2">
            {profile?.is_platform_admin ? (
              <Link href="/admin" className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
                Platform admin
              </Link>
            ) : null}
            <SignOutButton action={signOut} />
          </div>
        </div>
        <div className="px-4 pb-2 sm:px-6 lg:px-8">
          <Nav links={workspaceNav(workspace.slug)} label="Workspace" />
        </div>
      </header>
      {workspace.archived_at ? (
        <p role="status" className="border-b border-warning bg-surface-muted px-4 py-2 text-sm text-fg sm:px-6 lg:px-8">
          This workspace is archived. Everything is read only and public surveys show their closed message.
          {role === 'owner' ? ' The owner can unarchive it in Settings, General.' : ''}
        </p>
      ) : null}
      <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
