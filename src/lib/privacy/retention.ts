import 'server-only'
import { listRetentionWorkspaces, retentionBatch } from '@/lib/db/privacy'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteQueuedObjects } from './storage'

/**
 * Response retention (doc 04 section 7.5, R3), run daily at 03:00 UTC by
 * /api/cron/retention with CRON_SECRET. For each workspace with
 * retention_days set: retention_batch deletes up to 1,000 old responses
 * (answers, events and file rows go with them) and returns the workspace's
 * queued Storage deletions; the files are deleted through the Storage API and
 * reported back; repeat until nothing is left or 250 seconds pass.
 *
 * Decision: expired export files and import CSVs are left to the
 * storage-sweep cron (doc 01 section 13), which owns storage_sweep_batch.
 * Contacts are never deleted by retention.
 */
export const RETENTION_BUDGET_MS = 250_000
export const RETENTION_BATCH = 1000
const MAX_ROUNDS_PER_WORKSPACE = 200

export type RetentionLog = { workspace_id: string; rounds: number; files_deleted: number; files_failed: number; error?: string }

export async function runRetention(opts: { deadline?: number; now?: () => number } = {}): Promise<{ workspaces: RetentionLog[]; timedOut: boolean }> {
  const now = opts.now ?? Date.now
  const deadline = opts.deadline ?? now() + RETENTION_BUDGET_MS
  const admin = createAdminClient()
  const ws = await listRetentionWorkspaces(admin)
  if (!ws.ok) throw new Error(`retention: could not list workspaces: ${ws.error.message}`)
  const logs: RetentionLog[] = []
  let timedOut = false
  for (const workspaceId of ws.data) {
    if (now() > deadline) {
      timedOut = true
      break
    }
    const log: RetentionLog = { workspace_id: workspaceId, rounds: 0, files_deleted: 0, files_failed: 0 }
    for (let i = 0; i < MAX_ROUNDS_PER_WORKSPACE; i++) {
      if (now() > deadline) {
        timedOut = true
        break
      }
      const batch = await retentionBatch(admin, { workspaceId, limit: RETENTION_BATCH })
      log.rounds++
      if (!batch.ok) {
        log.error = batch.error.code
        break
      }
      if (batch.data.length === 0) break
      const res = await deleteQueuedObjects(admin, batch.data)
      log.files_deleted += res.done
      log.files_failed += res.failed
      // Nothing could be deleted this round: stop instead of spinning on the same rows.
      if (res.done === 0) break
    }
    logs.push(log)
  }
  return { workspaces: logs, timedOut }
}

/** Next 03:00 UTC after `from`. */
export function nextRetentionRun(from: Date = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 3, 0, 0))
  if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1)
  return d
}
