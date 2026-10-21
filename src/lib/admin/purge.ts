import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/supabase/types'
import { purgeWorkspace, workspacePurgeDue, type PurgeCounts } from '@/lib/db/admin'
import { completeStorageDeletions } from '@/lib/db/exports'
import { retentionBatch } from '@/lib/db/privacy'
import type { StorageDeletion } from '@/lib/db/rpc'

/**
 * Workspace hard delete job (doc 05 section 1.4, R3), run by Vercel Cron at
 * /api/cron/workspace-purge. Uses the service role only after the
 * CRON_SECRET bearer check in runWorkspacePurge.
 *
 * purge_workspace writes the platform audit row with final counts, holds the
 * slug and aliases, enqueues every Storage object under {workspace_id}/ into
 * storage_deletions, and deletes the row. This job then deletes those
 * objects from Storage and reports back with complete_storage_deletions.
 *
 * Reading the queue: retention_batch(workspace_id) returns that workspace's
 * undone storage_deletions. For a purged workspace the row is gone, so its
 * retention step is a no-op and only the queue comes back.
 * TODO(foundation): a dedicated `pending_storage_deletions(p_workspace_id)`
 * would say this plainly (foundation change request in the Phase 2A report).
 * Anything left behind (Storage outage) is retried by the orphan sweep.
 */

/** Constant time Bearer check. False when CRON_SECRET is unset. */
export function isCronAuthorized(authHeader: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || !authHeader) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(authHeader)
  return expected.length === got.length && timingSafeEqual(expected, got)
}

export type PurgeSummary = {
  workspaces: Array<{ id: string; counts?: PurgeCounts; error?: string; objectsDeleted: number; objectsFailed: number }>
}

/** Deletes the queued Storage objects, grouped by bucket, 100 per call. */
export async function deleteStorageObjects(
  admin: AdminClient,
  rows: StorageDeletion[],
): Promise<{ done: number[]; failed: Array<{ id: number; error: string }> }> {
  const done: number[] = []
  const failed: Array<{ id: number; error: string }> = []
  const byBucket = new Map<string, StorageDeletion[]>()
  for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r])
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100)
      try {
        const { error } = await admin.storage.from(bucket).remove(chunk.map((r) => r.path))
        if (error) for (const r of chunk) failed.push({ id: r.deletion_id, error: error.message.slice(0, 1000) })
        else for (const r of chunk) done.push(r.deletion_id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'storage remove failed'
        for (const r of chunk) failed.push({ id: r.deletion_id, error: msg.slice(0, 1000) })
      }
    }
  }
  return { done, failed }
}

async function drainWorkspaceQueue(admin: AdminClient, workspaceId: string): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failedCount = 0
  for (let round = 0; round < 20; round++) {
    const batch = await retentionBatch(admin, { workspaceId, limit: 1 })
    if (!batch.ok || batch.data.length === 0) break
    const { done, failed } = await deleteStorageObjects(admin, batch.data)
    await completeStorageDeletions(admin, { done, failed })
    deleted += done.length
    failedCount += failed.length
    if (done.length === 0) break // only failures left: stop, the sweep retries later
  }
  return { deleted, failed: failedCount }
}

export async function runWorkspacePurge(
  authHeader: string | null,
): Promise<{ status: 200; body: PurgeSummary } | { status: 401 | 500; body: { error: string } }> {
  if (!isCronAuthorized(authHeader)) return { status: 401, body: { error: 'unauthorized' } }
  const admin = createAdminClient()
  const due = await workspacePurgeDue(admin, { limit: 10 })
  if (!due.ok) return { status: 500, body: { error: due.error.code } }
  const summary: PurgeSummary = { workspaces: [] }
  for (const id of due.data) {
    const purged = await purgeWorkspace(admin, { workspaceId: id })
    if (!purged.ok) {
      summary.workspaces.push({ id, error: purged.error.code, objectsDeleted: 0, objectsFailed: 0 })
      continue
    }
    const { deleted, failed } = await drainWorkspaceQueue(admin, id)
    summary.workspaces.push({ id, counts: purged.data, objectsDeleted: deleted, objectsFailed: failed })
  }
  console.info('workspace-purge', JSON.stringify(summary))
  return { status: 200, body: summary }
}
