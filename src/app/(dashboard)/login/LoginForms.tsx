'use client'

import { useActionState, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { FormStatus, SubmitButton, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

/** Email and password, collapsed under Google (doc 05 section 4.1). */
export function EmailPasswordForm({
  signIn,
  signUp,
  next,
  allowSignUp,
}: {
  signIn: Action
  signUp: Action
  next: string
  allowSignUp: boolean
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [inState, inAction] = useActionState(signIn, IDLE)
  const [upState, upAction] = useActionState(signUp, IDLE)
  const state = mode === 'signin' ? inState : upState

  return (
    <form action={mode === 'signin' ? inAction : upAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldError(state, 'email')}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        minLength={8}
        required
        error={fieldError(state, 'password')}
        hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
      />
      <FormStatus state={state} />
      <SubmitButton>{mode === 'signin' ? 'Sign in' : 'Create account'}</SubmitButton>
      {allowSignUp ? (
        <button
          type="button"
          className="text-left text-sm text-accent underline underline-offset-2"
          onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
        >
          {mode === 'signin' ? 'New here with an invite? Create an account' : 'Already have an account? Sign in'}
        </button>
      ) : null}
    </form>
  )
}
