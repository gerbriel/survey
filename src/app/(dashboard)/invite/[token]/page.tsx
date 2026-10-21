import type { Metadata } from 'next'
import { getAuthContext, isPlausibleInviteToken } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { acceptInvite, continueToSignIn } from './actions'

export const metadata: Metadata = { title: 'Invite' }

/**
 * Invite landing for platform and workspace links. Shows no workspace data:
 * a signed-out visitor cannot read invites under RLS and anon has no
 * functions beyond the two public ones. Foundation change request: an
 * authenticated `invite_preview(p_token)` for the name, logo and role.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = isPlausibleInviteToken(token)
  const ctx = valid ? await getAuthContext() : null

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      {!valid ? (
        <>
          <h1 className="text-2xl font-semibold">This invite link is no longer valid</h1>
          <p className="text-sm text-muted">Ask the person who sent it for a new one.</p>
        </>
      ) : ctx ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold">You have been invited to Survey</h1>
            <p className="mt-2 text-sm text-muted">
              Accept as <strong className="text-fg">{ctx.user.email ?? 'your current account'}</strong>. If this is the
              wrong account, sign out first.
            </p>
          </div>
          <form action={acceptInvite.bind(null, token)}>
            <Button type="submit" className="w-full">
              Accept invite
            </Button>
          </form>
        </>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">You have been invited to Survey</h1>
            <p className="mt-2 text-sm text-muted">
              Sign in to accept. Google is the easiest way in. Expired or used links show a message after sign-in.
            </p>
          </div>
          <form action={continueToSignIn.bind(null, token)}>
            <Button type="submit" className="w-full">
              Continue to sign in
            </Button>
          </form>
        </>
      )}
    </main>
  )
}
