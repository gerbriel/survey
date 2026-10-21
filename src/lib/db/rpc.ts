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

type Res<D> = { data: D; error: unknown }

/**
 * An UPDATE or DELETE that RLS filtered to zero rows returns no error. Turn
 * that into permission_denied so the form says something true. Use with
 * `.select('id')` so the changed rows come back.
 */
export async function affected<D extends unknown[] | null>(q: PromiseLike<Res<D>>): Promise<Res<D>> {
  const r = await q
  if (!r.error && (!r.data || r.data.length === 0)) {
    return { data: r.data, error: { code: '42501', message: 'permission denied: no rows changed' } }
  }
  return r
}

/** Escape a user string for a PostgREST ilike pattern. */
export function ilikePattern(s: string): string {
  return `%${ilikeEscape(s)}%`
}

/** D-18: `_` and `%` (and the escape char) escaped, for a case-insensitive exact ilike match. */
export function ilikeEscape(s: string): string {
  return s.replace(/[\\%_,()]/g, (c) => `\\${c}`)
}

/** jsonb columns that are NOT NULL; the generated type says NonNullable<Json>. */
export function asJsonObject(value: unknown): NonNullable<Json> {
  return value as NonNullable<Json>
}

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** PostgREST caps a response at max_rows (1000, supabase/config.toml). */
export const PAGE = 1000

export type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Reads pages of PAGE rows until a short page or `max` rows. Never throws. */
export async function readAll<T>(page: (from: number, to: number) => PageResult<T>, max = 100_000): Promise<DbResult<T[]>> {
  const out: T[] = []
  try {
    for (let from = 0; from < max; from += PAGE) {
      const { data, error } = await page(from, Math.min(from + PAGE, max) - 1)
      if (error) return fail(toDbError(error))
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < PAGE) break
    }
    return ok(out)
  } catch (e) {
    return fail(toDbError(e))
  }
}

/**
 * D-17: a relative object name in the public-assets bucket, checked at write
 * time: no scheme, no leading slash, no `..` segment, no backslash, only
 * path-safe characters. Absolute URLs are refused, so a stored path can never
 * point a respondent's browser at a third-party host.
 */
export const ASSET_OBJECT_NAME_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._\-/]*$/

export function isAssetObjectName(path: string): boolean {
  return path.length <= 500 && ASSET_OBJECT_NAME_RE.test(path) && !path.includes('//')
}

export const assetObjectName = z.string().max(500).refine(isAssetObjectName, 'Asset paths must be object names in the public assets bucket.')
