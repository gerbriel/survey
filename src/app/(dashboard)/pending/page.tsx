import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { getOpenAccessRequest } from '@/lib/db/admin'
import { formatDate } from '@/lib/admin/lifecycle'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { AccessRequestForm, CheckAgainForm } from '@/components/settings/OnboardingForms'
import { signOut } from '../login/actions'
import { checkAgain, requestAccess } from './actions'

export const metadata: Metadata = { title: 'Waiting for access' }

/** Doc 05 section 4.2. Any pending profile lands here from every app route (requireUser). */
export default async function PendingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireUser({ allowPending: true })
  if (ctx.profile?.status === 'active') redirect('/')
  const sp = await searchParams
  const open = await getOpenAccessRequest(ctx.supabase, { userId: ctx.user.id })
  const request = open.ok ? open.data : null

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">You are signed in, but not invited yet</h1>
        <p className="mt-2 text-sm text-muted">
          Signed in as <strong className="text-fg">{ctx.user.email ?? 'an account without an email'}</strong>.
        </p>
        <p className="mt-2 text-sm text-muted">
          Survey is invite only. Open the invite link you were sent, or sign in with the email you were invited with.
        </p>
      </div>
      {sp.invite === 'invalid' ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          That invite link is no longer valid. Ask the person who sent it for a new one.
        </p>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">
        <CheckAgainForm action={checkAgain} />
        <SignOutButton action={signOut} label="Use another account" />
      </div>
      <section aria-labelledby="request-heading" className="rounded-lg border border-border p-4">
        <h2 id="request-heading" className="text-base font-semibold">
          Request access
        </h2>
        {request ? (
          <p className="mt-2 text-sm text-muted" role="status">
            You asked for access on {formatDate(request.created_at)}. A platform admin will review it. Nothing is
            emailed, so use Check again later.
          </p>
        ) : (
          <AccessRequestForm action={requestAccess} defaultName={ctx.profile?.display_name ?? ''} />
        )}
      </section>
    </main>
  )
}
