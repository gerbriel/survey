import 'server-only'

/**
 * Phase 2A local table wrappers.
 *
 * TODO(foundation): AGENTS.md says Phase 2 agents may add wrappers to
 * src/lib/db for their own tables, but src/lib/db is frozen for this phase.
 * These files follow the same contract (zod input, the `call` plumbing from
 * src/lib/db/rpc, DbResult out, never throw) and take the member's
 * UserClient, so RLS decides every row. Move them to src/lib/db/settings.ts
 * and src/lib/db/platform.ts when Fable unfreezes it (foundation change
 * request in the Phase 2A report).
 */

type Res<D> = { data: D; error: unknown }

/**
 * An UPDATE or DELETE that RLS filtered to zero rows returns no error. Turn
 * that into permission_denied so the form says something true.
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
  return `%${s.replace(/[\\%_,()]/g, (c) => `\\${c}`)}%`
}
