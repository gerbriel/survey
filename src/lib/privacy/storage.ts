import 'server-only'
import { completeStorageDeletions, objectName, removeQueuedObjects } from '@/lib/db/exports'
import type { StorageDeletion } from '@/lib/db/exports'
import type { AdminClient } from '@/lib/supabase/types'

/**
 * Deletes queued Storage objects and reports each row back with
 * complete_storage_deletions. Service role. The Storage calls live in
 * src/lib/db/exports.ts (removeQueuedObjects).
 */
export { objectName }

export async function deleteQueuedObjects(admin: AdminClient, rows: StorageDeletion[]): Promise<{ done: number; failed: number }> {
  const { done, failed } = await removeQueuedObjects(admin, rows)
  if (done.length || failed.length) await completeStorageDeletions(admin, { done, failed })
  return { done: done.length, failed: failed.length }
}
