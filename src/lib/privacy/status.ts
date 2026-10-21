import 'server-only'
import type { UserClient } from '@/lib/supabase/types'
import { nextRetentionRun } from './retention'

/**
 * Retention status for the privacy tools page: the workspace setting, how
 * many responses the next run would delete, and when it runs. As the member
 * under RLS. TODO(foundation): move to src/lib/db/privacy.ts.
 */
export type RetentionStatus = { retentionDays: number | null; dueNow: number | null; nextRun: string }

export async function retentionStatus(supabase: UserClient, workspace: { id: string; retention_days: number | null }): Promise<RetentionStatus> {
  const next = nextRetentionRun()
  if (!workspace.retention_days) return { retentionDays: null, dueNow: null, nextRun: next.toISOString() }
  const cutoff = new Date(next.getTime() - workspace.retention_days * 86400000).toISOString()
  const { count } = await supabase
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.id)
    .or(`submitted_at.lt.${cutoff},and(submitted_at.is.null,started_at.lt.${cutoff})`)
  return { retentionDays: workspace.retention_days, dueNow: count ?? 0, nextRun: next.toISOString() }
}
