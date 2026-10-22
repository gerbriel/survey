import Link from 'next/link'
import type { WorkspaceRole } from '@/types/db-helpers'
import type { ActionState } from '@/lib/admin/forms'
import { Badge } from '@/components/ui/Badge'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { WorkspaceEntry } from './WorkspaceEntry'

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
  /** The signed-in admin's own role there, or null when not a member. */
  myRole?: WorkspaceRole | null
}

const STATE_LABEL = { active: 'Active', archived: 'Archived', deletion_requested: 'Deletion requested' } as const
const STATE_TONE = { active: 'success', archived: 'warning', deletion_requested: 'danger' } as const

/** /admin/workspaces list: metadata and counts only, never workspace content (doc 05 section 6). */
export function AdminWorkspaceList({
  rows,
  joinAction,
}: {
  rows: AdminWorkspaceRow[]
  /** "Add me as admin" for workspaces the admin is not in. */
  joinAction?: (prev: ActionState, form: FormData) => Promise<ActionState>
}) {
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
          <Th>
            <span className="sr-only">Open</span>
          </Th>
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
            <Td>
              <WorkspaceEntry
                name={r.name}
                slug={r.slug}
                workspaceId={r.id}
                myRole={r.myRole ?? null}
                archived={r.state !== 'active'}
                deleted={r.state === 'deletion_requested'}
                joinAction={joinAction}
              />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}
