import Link from 'next/link'
import type { WorkspaceRole } from '@/types/db-helpers'
import type { ActionState } from '@/lib/admin/forms'
import { roleAtLeast } from '@/lib/auth/roles'
import { InlineAction } from '@/components/dashboard/InlineAction'

const linkClass =
  'inline-flex h-8 items-center whitespace-nowrap rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-muted'

/**
 * From the admin area into a workspace, to build surveys. A member gets
 * "Open workspace" (the surveys list) and, as editor or above on a live
 * workspace, "New survey". A non-member gets "Add me as admin", the audited
 * admin_add_workspace_member call, which then lands on the surveys list.
 */
export function WorkspaceEntry({
  name,
  slug,
  workspaceId,
  myRole,
  archived,
  deleted,
  joinAction,
}: {
  name: string
  slug: string
  workspaceId: string
  myRole: WorkspaceRole | null
  archived: boolean
  deleted: boolean
  joinAction?: (prev: ActionState, form: FormData) => Promise<ActionState>
}) {
  const base = `/w/${encodeURIComponent(slug)}/surveys`
  if (myRole) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={base} className={linkClass}>
          Open workspace<span className="sr-only"> {name}</span>
        </Link>
        {!archived && roleAtLeast(myRole, 'editor') ? (
          <Link href={`${base}/new`} className="inline-flex h-8 items-center whitespace-nowrap rounded-md bg-accent px-3 text-sm font-medium text-accent-fg">
            New survey<span className="sr-only"> in {name}</span>
          </Link>
        ) : null}
      </div>
    )
  }
  if (deleted || !joinAction) return null
  return (
    <InlineAction
      action={joinAction}
      fields={{ workspaceId }}
      label="Add me as admin"
      confirm={`You join ${name} as an admin and can see its surveys, responses and contacts. Logged in the platform audit log and the workspace activity log.`}
      confirmLabel="Add me"
    />
  )
}
