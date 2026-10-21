import 'server-only'
import { countRetentionDue } from '@/lib/db/privacy'
import type { UserClient } from '@/lib/supabase/types'
import { nextRetentionRun } from './retention'

/**
 * Retention status for the privacy tools page: the workspace setting, how
 * many responses the next run would delete, and when it runs. As the member
 * under RLS (countRetentionDue in src/lib/db/privacy.ts).
 */
export type RetentionStatus = { retentionDays: number | null; dueNow: number | null; nextRun: string }

export async function retentionStatus(supabase: UserClient, workspace: { id: string; retention_days: number | null }): Promise<RetentionStatus> {
  const next = nextRetentionRun()
  if (!workspace.retention_days) return { retentionDays: null, dueNow: null, nextRun: next.toISOString() }
  const cutoff = new Date(next.getTime() - workspace.retention_days * 86400000).toISOString()
  const due = await countRetentionDue(supabase, { workspaceId: workspace.id, cutoff })
  return { retentionDays: workspace.retention_days, dueNow: due.ok ? due.data : 0, nextRun: next.toISOString() }
}
