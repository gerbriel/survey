import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthContext, getCurrentWorkspace, LOGIN_PATH, requireUser } from '@/lib/auth'
import { listMyWorkspaceRequests } from '@/lib/db/admin'
import { formatDate } from '@/lib/admin/lifecycle'
import { Badge } from '@/components/ui/Badge'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { WorkspaceRequestForm } from '@/components/settings/OnboardingForms'
import { signOut } from './login/actions'
import { requestWorkspace } from './pending/actions'

export const metadata: Metadata = { title: 'Welcome' }

/**
 * `/` on the dashboard host (doc 05 section 4.4): signed out goes to /login,
 * pending to /pending, a member to their last workspace (profiles.last_workspace_id,
 * else the first by name). An active user with no workspace sees the welcome
 * screen here.
 * Decision: the welcome screen renders at `/` instead of `/welcome`, because
 * `welcome` is not a proxy segment (src/lib/hosts.ts is frozen) and `/` has
 * nowhere else to go for that user.
 */
export default async function DashboardHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await getAuthContext())) redirect(LOGIN_PATH)
  const ctx = await requireUser()
  const sp = await searchParams
  const inviteNote = typeof sp.invite === 'string' ? sp.invite : null

  const current = await getCurrentWorkspace()
  if (current) {
    const base = `/w/${encodeURIComponent(current.workspace.slug)}`
    redirect(inviteNote ? `${base}?invite=${encodeURIComponent(inviteNote)}` : base)
  }

  const requests = await listMyWorkspaceRequests(ctx.supabase, { userId: ctx.user.id })
  const mine = requests.ok ? requests.data : []
  const hasOpen = mine.some((r) => r.status === 'open')

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">Welcome to Survey</h1>
        <SignOutButton action={signOut} />
      </div>
      {inviteNote === 'invalid' ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          That invite link is no longer valid. Ask the person who sent it for a new one.
        </p>
      ) : null}
      <p className="text-sm text-muted">
        You are not in any workspace yet. Ask your workspace owner for an invite link, or request a new workspace.
      </p>
      {ctx.profile?.is_platform_admin ? (
        <p className="text-sm">
          You are a platform admin.{' '}
          <Link href="/admin" className="text-accent underline underline-offset-2">
            Open platform admin
          </Link>
        </p>
      ) : null}
      <section aria-labelledby="ws-request" className="rounded-lg border border-border p-4">
        <h2 id="ws-request" className="text-base font-semibold">
          Request a workspace
        </h2>
        {hasOpen ? (
          <p className="mt-2 text-sm text-muted" role="status">
            Your request is waiting for a platform admin.
          </p>
        ) : (
          <WorkspaceRequestForm action={requestWorkspace} />
        )}
        {mine.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {mine.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {r.department_name} <span className="text-muted">({formatDate(r.created_at)})</span>
                </span>
                <Badge tone={r.status === 'approved' ? 'success' : r.status === 'dismissed' ? 'neutral' : 'warning'}>
                  {r.status === 'open' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Dismissed'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  )
}
