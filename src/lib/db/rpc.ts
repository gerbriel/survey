import { z } from 'zod'
import type { Json } from '@/types/database'
import { fail, makeDbError, ok, toDbError, type DbResult } from './errors'

/**
 * Shared plumbing for the wrappers: validate input with zod, run the call,
 * and map every failure through errors.ts. Wrappers never throw; they return
 * a DbResult. Use `unwrap` from errors.ts where throwing is more convenient.
 */
export async function call<S extends z.ZodType, D, T = D>(
  schema: S,
  input: z.input<S>,
  exec: (v: z.output<S>) => PromiseLike<{ data: D; error: unknown }>,
  map?: (data: D, v: z.output<S>) => T,
): Promise<DbResult<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail(makeDbError('invalid_input', summarizeIssues(parsed.error)))
  try {
    const { data, error } = await exec(parsed.data)
    if (error) return fail(toDbError(error))
    return ok(map ? map(data, parsed.data) : (data as unknown as T))
  } catch (e) {
    return fail(toDbError(e))
  }
}

export function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : 'input'}: ${i.message}`)
    .join('; ')
}

/** Cast a validated plain object to the generated Json type for a jsonb argument. */
export function asJson(value: unknown): Json {
  return value as Json
}

// Shared schemas. z.guid() accepts any 8-4-4-4-12 hex id; seed ids such as
// 00000000-0000-0000-0000-000000000001 are not RFC 9562 versioned UUIDs.
export const id = z.guid()
export const jsonObject = z.record(z.string(), z.unknown())
export const workspaceRole = z.enum(['viewer', 'editor', 'admin', 'owner'])
/** Workspace slug, same rule as the workspaces.slug check constraint. */
export const workspaceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
export const empty = z.object({}).optional()

/** Rows returned by erase_respondent, retention_batch, storage_sweep_batch. */
export type StorageDeletion = { deletion_id: number; bucket: string; path: string }
