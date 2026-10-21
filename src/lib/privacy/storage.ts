import 'server-only'
import { completeStorageDeletions } from '@/lib/db/exports'
import type { StorageDeletion } from '@/lib/db/rpc'
import type { AdminClient } from '@/lib/supabase/types'

/**
 * Deletes queued Storage objects through the Storage API (deleting
 * storage.objects rows would orphan the files, doc 04 section 7.5) and
 * reports each row back with complete_storage_deletions. Service role.
 */

/** Same rule as SQL storage_object_name: drop a leading "{bucket}/". */
export function objectName(bucket: string, path: string): string {
  return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path
}

export async function deleteQueuedObjects(admin: AdminClient, rows: StorageDeletion[]): Promise<{ done: number; failed: number }> {
  const byBucket = new Map<string, StorageDeletion[]>()
  for (const r of rows) {
    const l = byBucket.get(r.bucket)
    if (l) l.push(r)
    else byBucket.set(r.bucket, [r])
  }
  const done: number[] = []
  const failed: { id: number; error: string }[] = []
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100)
      try {
        const { error } = await admin.storage.from(bucket).remove(part.map((r) => objectName(bucket, r.path)))
        if (error) for (const r of part) failed.push({ id: r.deletion_id, error: error.message.slice(0, 500) })
        // remove() succeeds for objects that are already gone, which is the goal.
        else for (const r of part) done.push(r.deletion_id)
      } catch (e) {
        for (const r of part) failed.push({ id: r.deletion_id, error: e instanceof Error ? e.message.slice(0, 500) : 'unknown' })
      }
    }
  }
  if (done.length || failed.length) await completeStorageDeletions(admin, { done, failed })
  return { done: done.length, failed: failed.length }
}
