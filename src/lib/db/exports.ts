import { z } from 'zod'
import type { AdminClient } from '@/lib/supabase/types'
import { asJson, call, type StorageDeletion } from './rpc'

/**
 * Storage cleanup jobs (migration 0015, R3), run from Vercel Cron with the
 * service role. storage_sweep_batch expires export files after 7 days and
 * import CSVs after 30, and deletes pending uploads older than 24 hours; the
 * cron route deletes the returned objects from Storage and reports back with
 * completeStorageDeletions.
 *
 * Row-level CSV and XLSX exports themselves are `export_jobs` table rows
 * under RLS (editor and above, doc 04 section 6); there is no SQL function.
 */
export type { StorageDeletion }

export const sweepInput = z.object({ limit: z.number().int().min(1).max(5000).default(500) })

export function storageSweepBatch(client: AdminClient, input: z.input<typeof sweepInput> = {}) {
  return call(
    sweepInput,
    input,
    (v) => client.rpc('storage_sweep_batch', { p_limit: v.limit }),
    (rows): StorageDeletion[] => (rows ?? []) as StorageDeletion[],
  )
}

export const completeDeletionsInput = z.object({
  done: z.array(z.number().int()).default([]),
  failed: z.array(z.object({ id: z.number().int(), error: z.string().max(1000) })).default([]),
})

export function completeStorageDeletions(client: AdminClient, input: z.input<typeof completeDeletionsInput>) {
  return call(
    completeDeletionsInput,
    input,
    (v) => client.rpc('complete_storage_deletions', { p_done: v.done, p_failed: asJson(v.failed) }),
    () => undefined,
  )
}
