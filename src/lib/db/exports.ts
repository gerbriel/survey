import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { AdminClient, UserClient } from '@/lib/supabase/types'
import { asJson, asJsonObject, call, id, type StorageDeletion } from './rpc'

/**
 * Storage cleanup jobs (migration 0015, R3), run from Vercel Cron with the
 * service role. storage_sweep_batch expires export files after 7 days and
 * import CSVs after 30, and deletes pending uploads older than 24 hours; the
 * cron route deletes the returned objects from Storage and reports back with
 * completeStorageDeletions.
 *
 * Row-level CSV and XLSX exports above the direct limit are `export_jobs`
 * rows (members insert and read under RLS, editor and above, doc 04 section
 * 6; the service role moves them through running, done and failed). Every
 * export is logged with log_export (migration 0018).
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

/** Same rule as SQL storage_object_name: drop a leading "{bucket}/". */
export function objectName(bucket: string, path: string): string {
  return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path
}

export type RemoveOutcome = { done: number[]; failed: Array<{ id: number; error: string }> }

/**
 * Service role. Deletes queued Storage objects through the Storage API
 * (deleting storage.objects rows would orphan the files, doc 04 section 7.5),
 * grouped by bucket, 100 per call. remove() succeeds for objects that are
 * already gone, which is the goal. Report the outcome back with
 * completeStorageDeletions. Never throws.
 */
export async function removeQueuedObjects(admin: AdminClient, rows: StorageDeletion[]): Promise<RemoveOutcome> {
  const done: number[] = []
  const failed: Array<{ id: number; error: string }> = []
  const byBucket = new Map<string, StorageDeletion[]>()
  for (const r of rows) {
    const l = byBucket.get(r.bucket)
    if (l) l.push(r)
    else byBucket.set(r.bucket, [r])
  }
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100)
      try {
        const { error } = await admin.storage.from(bucket).remove(part.map((r) => objectName(bucket, r.path)))
        if (error) for (const r of part) failed.push({ id: r.deletion_id, error: error.message.slice(0, 1000) })
        else for (const r of part) done.push(r.deletion_id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'storage remove failed'
        for (const r of part) failed.push({ id: r.deletion_id, error: msg.slice(0, 1000) })
      }
    }
  }
  return { done, failed }
}

// --- export jobs and the export log ----------------------------------------------

export type ExportJobRow = Tables<'export_jobs'>

export const createExportJobInput = z.object({
  workspaceId: id,
  surveyId: id,
  format: z.enum(['csv', 'xlsx']),
  filters: z.record(z.string(), z.unknown()),
  userId: id,
})

export function createExportJob(client: UserClient, input: z.input<typeof createExportJobInput>) {
  return call(
    createExportJobInput,
    input,
    (v) =>
      client
        .from('export_jobs')
        .insert({
          workspace_id: v.workspaceId,
          survey_id: v.surveyId,
          kind: 'responses',
          format: v.format,
          filters: asJsonObject(v.filters),
          created_by: v.userId,
        })
        .select('*')
        .single(),
    (row): ExportJobRow => row as ExportJobRow,
  )
}

export const exportJobIdInput = z.object({ jobId: id })

export function getExportJob(client: UserClient, input: z.input<typeof exportJobIdInput>) {
  return call(exportJobIdInput, input, (v) => client.from('export_jobs').select('*').eq('id', v.jobId).maybeSingle(), (row): ExportJobRow | null => row ?? null)
}

export const exportJobStatusInput = z.discriminatedUnion('status', [
  z.object({ jobId: id, status: z.literal('running') }),
  z.object({ jobId: id, status: z.literal('done'), storagePath: z.string().min(1).max(500), rowCount: z.number().int().min(0) }),
  z.object({ jobId: id, status: z.literal('failed') }),
])

/** Service role: export_jobs has no member update policy. */
export function setExportJobStatus(admin: AdminClient, input: z.input<typeof exportJobStatusInput>) {
  return call(
    exportJobStatusInput,
    input,
    (v) =>
      admin
        .from('export_jobs')
        .update(
          v.status === 'running'
            ? { status: 'running' }
            : v.status === 'done'
              ? { status: 'done', storage_path: v.storagePath, row_count: v.rowCount, finished_at: new Date().toISOString() }
              : { status: 'failed', finished_at: new Date().toISOString() },
        )
        .eq('id', v.jobId),
    () => undefined,
  )
}

export const EXPORT_KINDS = ['responses', 'contacts', 'summary', 'report'] as const

export const logExportInput = z.object({
  workspaceId: id,
  /** responses and contacts need editor; summary and report are open to viewers. */
  kind: z.enum(EXPORT_KINDS),
  /** Stored as the activity diff; survey_id and job_id, when set, must belong to the workspace. */
  scope: z.record(z.string(), z.unknown()).default({}),
  rowCount: z.number().int().min(0),
})

/** activity_log row for an export (log_export, migration 0018), as the member. */
export function logExport(client: UserClient, input: z.input<typeof logExportInput>) {
  return call(
    logExportInput,
    input,
    (v) =>
      client.rpc('log_export', {
        p_workspace_id: v.workspaceId,
        p_kind: v.kind,
        p_scope: asJson(v.scope),
        p_row_count: v.rowCount,
      }),
    () => undefined,
  )
}
