import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { completeStorageDeletions, storageSweepBatch } from '@/lib/db/exports'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Orphan upload sweep (doc 02 section 6, R3), Vercel Cron hourly with
 * CRON_SECRET. storage_sweep_batch deletes pending response_files rows older
 * than 24 hours (their delete trigger queues the objects), expires old
 * exports and imports, and returns every undone storage_deletions row. This
 * deletes those objects through the Storage API and reports back.
 */

/** Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`. Constant-time compare. */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type SweepCounts = { batches: number; returned: number; deleted: number; failed: number }

const BATCH = 500
const MAX_BATCHES = 20
const BUDGET_MS = 50_000

export async function runOrphanSweep(): Promise<SweepCounts> {
  const admin = createAdminClient()
  const counts: SweepCounts = { batches: 0, returned: 0, deleted: 0, failed: 0 }
  const started = Date.now()
  while (counts.batches < MAX_BATCHES && Date.now() - started < BUDGET_MS) {
    const r = await storageSweepBatch(admin, { limit: BATCH })
    if (!r.ok) throw new Error(`storage_sweep_batch failed: ${r.error.code}`)
    counts.batches++
    const rows = r.data
    counts.returned += rows.length
    if (rows.length === 0) break

    const byBucket = new Map<string, typeof rows>()
    for (const row of rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row])
    const done: number[] = []
    const failed: { id: number; error: string }[] = []
    for (const [bucket, list] of byBucket) {
      // Storage remove() succeeds for paths that are already gone, so a retry is safe.
      const res = await admin.storage.from(bucket).remove(list.map((x) => x.path))
      if (res.error) for (const x of list) failed.push({ id: x.deletion_id, error: res.error.message.slice(0, 1000) })
      else for (const x of list) done.push(x.deletion_id)
    }
    counts.deleted += done.length
    counts.failed += failed.length
    const c = await completeStorageDeletions(admin, { done, failed })
    if (!c.ok) throw new Error(`complete_storage_deletions failed: ${c.error.code}`)
    // Rows that failed come back on the next call; stop rather than spin on them.
    if (rows.length < BATCH || done.length === 0) break
  }
  return counts
}
