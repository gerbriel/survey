'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { claimInvitesFromCookies, LOGIN_PATH, postSignInPath, signupInviteGuard } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/db/profiles'
import { failure, formToObject, fromZodError, type ActionState } from '@/lib/admin/forms'

/**
 * Email and password sign-in, the secondary path (doc 05 section 4.1).
 * Supabase Auth is the boundary here; afterwards invite cookies are claimed
 * through SQL exactly like the OAuth callback does.
 */

const credentials = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase().max(320),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  next: z.string().max(2000).optional(),
})

async function finishSignIn(userId: string, next: string | undefined): Promise<never> {
  const supabase = await createServerClient()
  const outcome = await claimInvitesFromCookies(supabase)
  const profile = await getProfile(supabase, { userId })
  redirect(postSignInPath(outcome, profile.ok && profile.data ? profile.data.status : null, next ?? null))
}

export async function signInWithPassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse(formToObject(form))
  if (!parsed.success) return fromZodError(parsed.error)
  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error || !data.user) return failure('Email or password is incorrect.')
  return finishSignIn(data.user.id, parsed.data.next)
}

/**
 * S1 (R18): password sign-up requires an invite token in the invite cookie;
 * without one the action refuses and points to the invite link or Google.
 * The tokens ride the signup metadata so the handle_new_user trigger can
 * claim them; SQL (0019) never claims a platform invite by email match for a
 * password signup, so a bare API signup still lands in pending.
 */
export async function signUpWithPassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse(formToObject(form))
  if (!parsed.success) return fromZodError(parsed.error)
  const store = await cookies()
  const guard = signupInviteGuard((name) => store.get(name)?.value)
  if (!guard.ok) return failure(guard.message)
  const { workspaceToken, platformToken } = guard
  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        ...(workspaceToken ? { workspace_invite_token: workspaceToken } : {}),
        ...(platformToken ? { platform_invite_token: platformToken } : {}),
      },
    },
  })
  if (error) {
    return failure(
      /already registered|already exists/i.test(error.message)
        ? 'An account with that email already exists. Sign in instead.'
        : 'Could not create the account. Check the email and password and try again.',
    )
  }
  if (!data.user || !data.session) {
    return failure('Account created, but sign-in needs email confirmation, which this deployment does not send. Ask a platform admin.')
  }
  return finishSignIn(data.user.id, parsed.data.next)
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect(LOGIN_PATH)
}
