import Link from 'next/link'
import { DuplicatePairs, type Pair } from '@/components/crm/DuplicatePairs'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { contactDuplicateCandidates } from '@/lib/db/contacts'
import { listContactsByIds, type Contact } from '@/lib/crm/data/contacts'
import { chunk } from '@/lib/crm/import'
import { dismissDuplicateAction } from '../actions'

export default async function DuplicatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, workspace, role } = await requireMember(slug, 'viewer')
  const cands = await contactDuplicateCandidates(supabase, { workspaceId: workspace.id })
  const list = cands.ok ? cands.data : []
  const ids = [...new Set(list.flatMap((c) => [c.contact_a, c.contact_b]))]
  const contacts = new Map<string, Contact>()
  for (const part of chunk(ids, 500)) {
    const r = await listContactsByIds(supabase, { workspaceId: workspace.id, ids: part })
    if (r.ok) for (const c of r.data) contacts.set(c.id, c)
  }
  const pairs: Pair[] = list.flatMap((c) => {
    const a = contacts.get(c.contact_a)
    const b = contacts.get(c.contact_b)
    return a && b ? [{ a, b, reason: c.reason }] : []
  })
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Link href={`/w/${slug}/contacts`} className="text-sm text-accent">
        Back to contacts
      </Link>
      <h1 className="text-xl font-semibold">Possible duplicates</h1>
      <p className="text-sm text-muted">Computed now from phones, names, emails and responses. At most 500 pairs are shown.</p>
      {!cands.ok ? (
        <p role="alert" className="text-sm text-danger">
          {cands.error.message}
        </p>
      ) : null}
      <DuplicatePairs
        slug={slug}
        pairs={pairs}
        canEdit={roleAtLeast(role, 'editor') && !workspace.archived_at}
        dismiss={dismissDuplicateAction.bind(null, slug)}
      />
    </main>
  )
}
