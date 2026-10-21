import type { z } from 'zod'
import type { DbError, DbResult } from '@/lib/db/errors'

/**
 * Form state shared by every Phase 2A server action and the client forms
 * that call them through useActionState. Pure, no server imports, so client
 * components can import the type and the initial value.
 */
export type ActionState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  /** Field name to message, for inline errors. */
  fieldErrors?: Record<string, string>
  /** Optional payload for the caller, for example a minted link shown once. */
  data?: Record<string, string>
}

export const IDLE: ActionState = { status: 'idle' }

export function success(message: string, data?: Record<string, string>): ActionState {
  return data ? { status: 'success', message, data } : { status: 'success', message }
}

export function failure(message: string, fieldErrors?: Record<string, string>): ActionState {
  return fieldErrors ? { status: 'error', message, fieldErrors } : { status: 'error', message }
}

/** A DbError as form state. `message` is the plain copy errors.ts writes for members. */
export function fromDbError(error: DbError): ActionState {
  return failure(error.message)
}

/** First issue per field from a zod error. */
export function fromZodError(error: z.ZodError, message = 'Check the highlighted fields.'): ActionState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : 'form'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return failure(message, fieldErrors)
}

/** Maps a DbResult to form state with a success message. */
export function fromResult<T>(result: DbResult<T>, okMessage: string): ActionState {
  return result.ok ? success(okMessage) : fromDbError(result.error)
}

/** FormData to a plain object of strings; repeated keys keep the last value. Files are skipped. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v
  return out
}

/** Checkbox semantics: present and not "false" or "off" means true. */
export function formBool(form: FormData, key: string): boolean {
  const v = form.get(key)
  return typeof v === 'string' && v !== '' && v !== 'false' && v !== 'off'
}

/** Form strings with blank optional fields turned into null, ready for a wrapper's zod schema. */
export function formFields<K extends string>(form: FormData, nullable: readonly K[] = []): Record<string, string | null> {
  const out: Record<string, string | null> = formToObject(form)
  for (const k of nullable) {
    const v = out[k]
    if (v === undefined || v === null || v.trim() === '') out[k] = null
  }
  return out
}
