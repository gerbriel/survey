import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { getEffectiveLimits } from '@/lib/db/limits'
import { getWorkspaceLimitsRow } from '@/lib/db/admin'
import { formatBytes, formatDateTime } from '@/lib/admin/lifecycle'
import { LimitsTable } from '@/components/settings/LimitsTable'
import { limitRows } from '@/components/settings/limits-view'

export const metadata: Metadata = { title: 'Limits' }

/** Read only for every member (doc 05 section 5.6). Only a platform admin changes overrides. */
export default async function LimitsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, supabase } = await requireMember(slug)
  const [effective, overrides] = await Promise.all([
    getEffectiveLimits(supabase, { workspaceId: workspace.id }),
    getWorkspaceLimitsRow(supabase, { workspaceId: workspace.id }),
  ])
  const rows = limitRows(effective.ok ? effective.data : null, overrides.ok ? overrides.data : null)
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Limits</h2>
      <p className="text-sm text-muted">
        Fixed limits for every workspace. A platform admin can adjust them for this workspace when there is a reason.
      </p>
      <LimitsTable rows={rows} />
      <p className="text-sm text-muted">
        Storage used: <span className="font-medium text-fg">{formatBytes(workspace.storage_bytes_used)}</span>
        {workspace.storage_reconciled_at ? ` (counted ${formatDateTime(workspace.storage_reconciled_at)})` : ''}. There
        is no storage quota.
      </p>
    </div>
  )
}
