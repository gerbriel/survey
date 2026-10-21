import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuthContext, PLATFORM_INVITE_COOKIE, safeNextPath, WORKSPACE_INVITE_COOKIE } from '@/lib/auth'
import { signInWithPassword, signUpWithPassword } from './actions'
import { EmailPasswordForm } from './LoginForms'

export const metadata: Metadata = { title: 'Sign in' }

const ERRORS: Record<string, string> = {
  oauth: 'Google sign-in did not finish. Try again.',
  account_disabled: 'This account is turned off. Ask a platform admin if you think that is a mistake.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null, '')
  const errorKey = typeof sp.error === 'string' ? sp.error : null

  const ctx = await getAuthContext()
  if (ctx && ctx.profile?.status === 'active' && errorKey !== 'account_disabled') redirect(next || '/')

  const store = await cookies()
  const hasInvite = Boolean(store.get(WORKSPACE_INVITE_COOKIE) || store.get(PLATFORM_INVITE_COOKIE))
  const googleHref = next ? `/login/google?next=${encodeURIComponent(next)}` : '/login/google'

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Sign in to Survey</h1>
        <p className="mt-1 text-sm text-muted">
          {hasInvite ? 'Sign in to accept your invite.' : 'Survey is invite only. Use the account you were invited with.'}
        </p>
      </div>
      {errorKey && ERRORS[errorKey] ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          {ERRORS[errorKey]}
        </p>
      ) : null}
      <a
        href={googleHref}
        className="inline-flex h-12 items-center justify-center rounded-md bg-accent px-4 text-base font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        Continue with Google
      </a>
      <details className="rounded-md border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Use email and password</summary>
        <p className="mt-2 text-xs text-muted">Prefer Google. Password reset is not self-serve.</p>
        <div className="mt-4">
          <EmailPasswordForm signIn={signInWithPassword} signUp={signUpWithPassword} next={next} allowSignUp={hasInvite} />
        </div>
      </details>
    </main>
  )
}
