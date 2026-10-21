import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui'
import { asDefinition } from '@/components/responses/answers'
import { ContactHeader } from '@/components/crm/ContactHeader'
import { CustomFieldsPanel } from '@/components/crm/CustomFieldsPanel'
import { DuplicatePairs, type Pair } from '@/components/crm/DuplicatePairs'
import { NotesPanel } from '@/components/crm/NotesPanel'
import { TagEditor } from '@/components/crm/TagEditor'
import { Timeline } from '@/components/crm/Timeline'
import { buildTimeline } from '@/components/crm/timelineData'
import { memberName } from '@/components/crm/types'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { contactDuplicateCandidates } from '@/lib/db/contacts'
import {
  getContact,
  listContactActivity,
  listContactsByIds,
  listFieldDefs,
  listMembers,
  listNotes,
  listWorkspaceTags,
} from '@/lib/crm/data/contacts'
import { getVersionDefinitions, listAnswersFor, listContactResponses } from '@/lib/crm/data/responses'
import {
  addNoteAction,
  deleteNoteAction,
  dismissDuplicateAction,
  editNoteAction,
  setCustomAction,
  updateContactAction,
} from '../actions'

/** Answers load for the newest responses only; older ones show without a preview. */
const PREVIEW_RESPONSES = 30

export default async function ContactDetailPage({ params }: { params: Promise<{ slug: string; contactId: string }> }) {
  const { slug, contactId } = await params
  const { supabase, workspace, role, user } = await requireMember(slug, 'viewer')
  const canEdit = roleAtLeast(role, 'editor') && !workspace.archived_at
  const r = await getContact(supabase, { contactId })
  if (!r.ok || !r.data || r.data.workspace_id !== workspace.id) notFound()
  const contact = r.data
  // Merged contacts redirect to the survivor so old bookmarks keep working.
  if (contact.merged_into) redirect(`/w/${slug}/contacts/${contact.merged_into}`)
  if (contact.status === 'deleted') {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <EmptyState title="This contact was erased" description="Personal data was removed at a privacy request. Responses kept for reports are anonymous." />
      </main>
    )
  }

  const [notes, defs, members, responses, activity, tags, dupes] = await Promise.all([
    listNotes(supabase, { contactId }),
    listFieldDefs(supabase, { workspaceId: workspace.id }),
    listMembers(supabase, { workspaceId: workspace.id }),
    listContactResponses(supabase, { contactId }),
    listContactActivity(supabase, { contactId }),
    listWorkspaceTags(supabase, { workspaceId: workspace.id }),
    contactDuplicateCandidates(supabase, { workspaceId: workspace.id }),
  ])
  const memberList = members.ok ? members.data : []
  const responseList = responses.ok ? responses.data : []
  const recent = responseList.slice(0, PREVIEW_RESPONSES)
  const versionIds = [...new Set(responseList.map((x) => x.survey_version_id))].slice(0, 200)
  const [answers, versions] = await Promise.all([
    recent.length ? listAnswersFor(supabase, { responseIds: recent.map((x) => x.id) }) : Promise.resolve(null),
    versionIds.length ? getVersionDefinitions(supabase, { versionIds }) : Promise.resolve(null),
  ])
  const versionMap = new Map(
    (versions && versions.ok ? versions.data : []).map((v) => [v.id, { version_no: v.version_no, def: asDefinition(v.public_definition) }]),
  )
  const items = buildTimeline({
    slug,
    responses: responseList,
    answers: answers && answers.ok ? answers.data : [],
    versions: versionMap,
    notes: notes.ok ? notes.data : [],
    activity: activity.ok ? activity.data : [],
    authorName: (id) => memberName(memberList, id),
  })

  // A contact is unverified while every response linking it came through a hidden field.
  const unverified = responseList.length > 0 && responseList.every((x) => x.identity_source === 'hidden_field')

  const mine = (dupes.ok ? dupes.data : []).filter((d) => d.contact_a === contactId || d.contact_b === contactId)
  const otherIds = mine.map((d) => (d.contact_a === contactId ? d.contact_b : d.contact_a))
  const others = otherIds.length ? await listContactsByIds(supabase, { workspaceId: workspace.id, ids: otherIds }) : null
  const pairs: Pair[] = mine.flatMap((d) => {
    const otherId = d.contact_a === contactId ? d.contact_b : d.contact_a
    const other = others && others.ok ? others.data.find((c) => c.id === otherId) : undefined
    return other ? [{ a: contact, b: other, reason: d.reason }] : []
  })

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <nav className="text-sm">
        <Link href={`/w/${slug}/contacts`} className="text-accent">
          Back to contacts
        </Link>
      </nav>
      <ContactHeader
        contact={contact}
        members={memberList}
        canEdit={canEdit}
        unverified={unverified}
        update={updateContactAction.bind(null, slug, contactId)}
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        <Timeline items={items} />
        <aside className="flex flex-col gap-6">
          <TagEditor
            tags={contact.tags}
            suggestions={tags.ok ? tags.data : []}
            canEdit={canEdit}
            save={async (next: string[]) => {
              'use server'
              return updateContactAction(slug, contactId, { tags: next })
            }}
          />
          <CustomFieldsPanel
            defs={defs.ok ? defs.data : []}
            custom={(contact.custom ?? {}) as Record<string, unknown>}
            canEdit={canEdit}
            save={setCustomAction.bind(null, slug, contactId)}
          />
          <NotesPanel
            notes={notes.ok ? notes.data : []}
            members={memberList}
            userId={user.id}
            canEdit={canEdit}
            isAdmin={roleAtLeast(role, 'admin')}
            add={addNoteAction.bind(null, slug, contactId)}
            edit={editNoteAction.bind(null, slug, contactId)}
            remove={deleteNoteAction.bind(null, slug, contactId)}
          />
          <section aria-label="Possible duplicates" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Possible duplicates</h2>
            <DuplicatePairs slug={slug} pairs={pairs} canEdit={canEdit} dismiss={dismissDuplicateAction.bind(null, slug)} compact />
          </section>
        </aside>
      </div>
    </main>
  )
}
