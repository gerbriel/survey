import type { WorkspaceRole } from '@/types/db-helpers'
import { Badge } from '@/components/ui/Badge'

const LABELS: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }
const TONES = { owner: 'accent', admin: 'success', editor: 'neutral', viewer: 'neutral' } as const

export function roleLabel(role: WorkspaceRole): string {
  return LABELS[role]
}

/** The member's role in a workspace, as text (never color alone). */
export function RoleBadge({ role, className }: { role: WorkspaceRole; className?: string }) {
  return (
    <Badge tone={TONES[role]} className={className}>
      {LABELS[role]}
    </Badge>
  )
}
