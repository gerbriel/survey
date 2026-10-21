import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/auth'
import { PageHeader } from '@/components/dashboard/PageHeader'

/**
 * /w/[slug] goes to the workspace dashboard (Phase 2E). With an invite note
 * from the sign-in redirect it says so first (doc 05 section 3.2: "You are
 * already a member").
 */
export default async function WorkspaceIndex({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const dashboard = `/w/${encodeURIComponent(slug)}/dashboard`
  const note = typeof sp.invite === 'string' ? sp.invite : null
  if (note !== 'already_member' && note !== 'invalid') redirect(dashboard)
  const { workspace, role } = await requireMember(slug)

  return (
    <div className="max-w-xl">
      <PageHeader title={workspace.name} />
      <p role="status" className="mb-4 text-sm">
        {note === 'already_member'
          ? `You are already a member of this workspace. Your role (${role}) is unchanged.`
          : 'That invite link is no longer valid. Ask the person who sent it for a new one.'}
      </p>
      <Link href={dashboard} className="text-accent underline underline-offset-2">
        Continue to the dashboard
      </Link>
    </div>
  )
}
