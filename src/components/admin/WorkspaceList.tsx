import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'

export type AdminWorkspaceRow = {
  id: string
  name: string
  slug: string
  owner: string
  members: number
  surveys: number
  responses: number
  storage: string
  created: string
  state: 'active' | 'archived' | 'deletion_requested'
  stateNote: string | null
}

const STATE_LABEL = { active: 'Active', archived: 'Archived', deletion_requested: 'Deletion requested' } as const
const STATE_TONE = { active: 'success', archived: 'warning', deletion_requested: 'danger' } as const

/** /admin/workspaces list: metadata and counts only, never workspace content (doc 05 section 6). */
export function AdminWorkspaceList({ rows }: { rows: AdminWorkspaceRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No workspaces yet.</p>
  return (
    <Table caption="All workspaces">
      <THead>
        <Tr>
          <Th>Workspace</Th>
          <Th>Owner</Th>
          <Th className="text-right">Members</Th>
          <Th className="text-right">Surveys</Th>
          <Th className="text-right">Responses</Th>
          <Th className="text-right">Storage</Th>
          <Th>Created</Th>
          <Th>Status</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>
              <Link href={`/admin/workspaces/${r.id}`} className="font-medium text-accent underline underline-offset-2">
                {r.name}
              </Link>
              <div className="text-xs text-muted">/w/{r.slug}</div>
            </Td>
            <Td>{r.owner}</Td>
            <Td className="text-right tabular-nums">{r.members.toLocaleString('en-US')}</Td>
            <Td className="text-right tabular-nums">{r.surveys.toLocaleString('en-US')}</Td>
            <Td className="text-right tabular-nums">{r.responses.toLocaleString('en-US')}</Td>
            <Td className="text-right tabular-nums">{r.storage}</Td>
            <Td className="whitespace-nowrap">{r.created}</Td>
            <Td>
              <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge>
              {r.stateNote ? <div className="mt-1 text-xs text-muted">{r.stateNote}</div> : null}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}
