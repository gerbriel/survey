import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { listProfiles } from '@/lib/admin/db/platform'
import { listAuthUsers, membershipsByUser, type AuthUserSummary, type UserMembership } from '@/lib/admin/service'
import { formatDate } from '@/lib/admin/lifecycle'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { roleLabel } from '@/components/dashboard/RoleBadge'
import { ResetLinkForm } from '@/components/admin/AdminForms'
import { mintResetLink, setUserActive } from '../actions'

export const metadata: Metadata = { title: 'Users' }

const STATUS_TONE = { active: 'success', pending: 'warning', disabled: 'danger', deleted: 'neutral' } as const

/** Users: search, status, memberships, reset link, deactivate (doc 05 section 6). */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePlatformAdmin()
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q.trim().toLowerCase().slice(0, 120) : ''
  const statusParam = typeof sp.status === 'string' ? sp.status : ''
  const status = (['pending', 'active', 'disabled', 'deleted'] as const).find((s) => s === statusParam)

  const [profiles, users, memberships] = await Promise.all([
    listProfiles(ctx.supabase, status ? { status } : {}),
    listAuthUsers(),
    membershipsByUser(),
  ])
  const emails = users.ok ? users.data : new Map<string, AuthUserSummary>()
  const mem = memberships.ok ? memberships.data : new Map<string, UserMembership[]>()
  const rows = (profiles.ok ? profiles.data : []).filter((p) => {
    if (!q) return true
    const email = emails.get(p.id)?.email ?? ''
    return p.display_name.toLowerCase().includes(q) || email.toLowerCase().includes(q)
  })

  return (
    <>
      <PageHeader title="Users" description="Everyone who has signed in. Password reset is admin assisted: generate a link and share it yourself." />
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-3 sm:items-end">
        <Input label="Search name or email" name="q" defaultValue={q} />
        <Select
          label="Status"
          name="status"
          defaultValue={status ?? ''}
          placeholder="Any"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'pending', label: 'Pending' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <div className="flex gap-2">
          <Button type="submit">Search</Button>
          <Link href="/admin/users" className="inline-flex h-10 items-center px-2 text-sm text-accent underline underline-offset-2">
            Clear
          </Link>
        </div>
      </form>
      {!users.ok ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          Emails are unavailable: {users.error.message}
        </p>
      ) : null}
      <Table caption="Users">
        <THead>
          <Tr>
            <Th>User</Th>
            <Th>Status</Th>
            <Th>Workspaces</Th>
            <Th>Last sign-in</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((p) => {
            const u = emails.get(p.id)
            const ms = mem.get(p.id) ?? []
            const isOwner = ms.some((m) => m.role === 'owner')
            return (
              <Tr key={p.id}>
                <Td>
                  <div className="font-medium">
                    {p.display_name}
                    {p.is_platform_admin ? <span className="text-muted"> (platform admin)</span> : null}
                  </div>
                  <div className="text-xs text-muted">{u?.email ?? 'No email'}</div>
                  {u?.providers.length ? <div className="text-xs text-muted">Sign-in: {u.providers.join(', ')}</div> : null}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                </Td>
                <Td>
                  {ms.length === 0 ? (
                    <span className="text-muted">None</span>
                  ) : (
                    <ul className="text-xs">
                      {ms.map((m) => (
                        <li key={m.workspaceId}>
                          {m.name} ({roleLabel(m.role)})
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{u?.lastSignInAt ? formatDate(u.lastSignInAt) : 'Never'}</Td>
                <Td>
                  <div className="flex flex-col gap-2">
                    {u?.email ? <ResetLinkForm action={mintResetLink} userId={p.id} /> : null}
                    {p.id !== ctx.user.id && p.status === 'active' ? (
                      isOwner ? (
                        <span className="text-xs text-muted">Owns a workspace: transfer before deactivating.</span>
                      ) : (
                        <InlineAction
                          action={setUserActive}
                          fields={{ userId: p.id, active: 'false' }}
                          label="Deactivate"
                          variant="danger"
                          confirm={`${p.display_name} will be signed out and blocked from signing in. Their memberships stay.`}
                        />
                      )
                    ) : null}
                    {p.status === 'disabled' ? (
                      <InlineAction action={setUserActive} fields={{ userId: p.id, active: 'true' }} label="Reactivate" />
                    ) : null}
                  </div>
                </Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </>
  )
}
