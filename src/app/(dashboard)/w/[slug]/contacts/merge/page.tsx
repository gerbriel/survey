import Link from 'next/link'
import { EmptyState } from '@/components/ui'
import { defaultSurvivor } from '@/components/crm/merge'
import { MergeFlow } from '@/components/crm/MergeFlow'
import { requireMember } from '@/lib/auth'
import { countNotesAndTokens, listContactsByIds, listFieldDefs } from '@/lib/db/contacts'
import { listMembers } from '@/lib/db/workspaces'
import { mergeAction } from '../actions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { supabase, workspace } = await requireMember(slug, 'editor', { deniedRedirect: `/w/${slug}/contacts` })
  const raw = Array.isArray(sp.ids) ? sp.ids.join(',') : (sp.ids ?? '')
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))]
  const back = (
    <Link href={`/w/${slug}/contacts`} className="text-sm text-accent">
      Back to contacts
    </Link>
  )
  if (ids.length < 2 || ids.length > 5) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {back}
        <EmptyState title="Pick 2 to 5 contacts" description="Select contacts in the list or open a possible duplicate pair." />
      </main>
    )
  }
  const [contacts, defs, members, counts] = await Promise.all([
    listContactsByIds(supabase, { workspaceId: workspace.id, ids }),
    listFieldDefs(supabase, { workspaceId: workspace.id }),
    listMembers(supabase, { workspaceId: workspace.id }),
    countNotesAndTokens(supabase, { contactIds: ids }),
  ])
  const live = (contacts.ok ? contacts.data : []).filter((c) => c.status === 'active' && !c.merged_into)
  if (live.length < 2) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {back}
        <EmptyState title="These contacts cannot be merged" description="At least two of them must still be live contacts." />
      </main>
    )
  }
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      {back}
      <h1 className="text-xl font-semibold">Merge contacts</h1>
      <MergeFlow
        slug={slug}
        contacts={live}
        defs={defs.ok ? defs.data : []}
        members={members.ok ? members.data : []}
        counts={counts.ok ? counts.data : { notes: {}, tokens: {} }}
        initialSurvivor={defaultSurvivor(live)}
        merge={mergeAction.bind(null, slug)}
      />
    </main>
  )
}
