import Link from 'next/link'
import { FieldRegistryEditor } from '@/components/crm/FieldRegistryEditor'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { listFieldDefs } from '@/lib/crm/data/contacts'
import { createFieldDefAction, updateFieldDefAction } from '../actions'

export default async function FieldsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, workspace, role } = await requireMember(slug, 'viewer')
  const defs = await listFieldDefs(supabase, { workspaceId: workspace.id })
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Link href={`/w/${slug}/contacts`} className="text-sm text-accent">
        Back to contacts
      </Link>
      <h1 className="text-xl font-semibold">Custom contact fields</h1>
      <p className="text-sm text-muted">Archiving hides a field everywhere but keeps its values.</p>
      <FieldRegistryEditor
        defs={defs.ok ? defs.data : []}
        canEdit={roleAtLeast(role, 'editor') && !workspace.archived_at}
        create={createFieldDefAction.bind(null, slug)}
        update={updateFieldDefAction.bind(null, slug)}
      />
    </main>
  )
}
