import Link from 'next/link'
import { requireMember, memberCan } from '@/lib/auth'
import { listSurveys } from '@/lib/db/surveys'
import { listMembers } from '@/lib/db/workspaces'
import { groupAssignments, listAssignmentsForSurveys, matchesAssignmentFilter } from '@/lib/db/assignments'
import { effectiveState, stateText, requestTime } from '@/lib/builder/state'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SurveyList, type OwnerOption, type SurveyListRow } from '@/components/builder/SurveyList'
import { readListQuery } from '@/components/builder/listModel'

/**
 * Surveys list. The server loads the live or archived surveys and applies the
 * assignment filter (it needs collaborator ids); search, state, owner, updated
 * range and sort are applied to the loaded rows by the shared list model, on
 * the server for the first render and on the client after that. State uses the
 * same effectiveState as the badge.
 */
export default async function SurveysPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const query = readListQuery(await searchParams)
  const { supabase, workspace, role, user } = await requireMember(slug, 'viewer')
  const canEdit = memberCan(role, 'editor', workspace)
  // UX only: delete_survey in SQL refuses anyone below admin (doc 00, Tenancy).
  const canDelete = memberCan(role, 'admin', workspace)
  const archivedView = query.state === 'archived'
  const r = await listSurveys(supabase, { workspaceId: workspace.id, archived: archivedView })
  const surveys = r.ok ? r.data : []
  const [a, m] = await Promise.all([
    listAssignmentsForSurveys(supabase, { surveyIds: surveys.map((s) => s.id) }),
    listMembers(supabase, { workspaceId: workspace.id }),
  ])
  const people = groupAssignments(a.ok ? a.data : [])
  const now = requestTime()
  const person = (p: { display_name: string; avatar_url: string | null }) => ({ name: p.display_name, avatarUrl: p.avatar_url })
  const rows: SurveyListRow[] = surveys
    .filter((s) => matchesAssignmentFilter(query.assigned, people.get(s.id), user.id))
    .map((s) => {
      const owner = people.get(s.id)?.owner ?? null
      return {
        id: s.id,
        title: s.title,
        slug: s.slug,
        state: effectiveState(s, now, workspace.archived_at !== null).state,
        stateText: stateText(s, now),
        responses: s.complete_count,
        cap: s.response_cap,
        updatedAt: s.updated_at,
        archived: s.archived_at !== null,
        ownerId: owner?.user_id ?? null,
        ownerName: owner?.display_name ?? null,
        owner: owner ? person(owner) : null,
        collaborators: (people.get(s.id)?.collaborators ?? []).map(person),
      }
    })
  const owners: OwnerOption[] = (m.ok ? m.data : []).map((x) => ({ id: x.user_id, name: x.display_name, avatarUrl: x.avatar_url }))
  const wsBase = `/w/${encodeURIComponent(workspace.slug)}`
  const base = `${wsBase}/surveys`
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Surveys"
        description="Build, publish and share surveys and forms."
        actions={
          canEdit ? (
            <Link href={`${base}/new`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
              New survey
            </Link>
          ) : undefined
        }
      />
      {!r.ok ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          Surveys could not be loaded: {r.error.message}
        </p>
      ) : null}
      {!a.ok ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          Owners and collaborators could not be loaded: {a.error.message}
        </p>
      ) : null}
      <SurveyList
        key={archivedView ? 'archived' : 'live'}
        rows={rows}
        base={base}
        slug={workspace.slug}
        exportAction={`${wsBase}/results/export`}
        canEdit={canEdit}
        canDelete={canDelete}
        archivedView={archivedView}
        initialQuery={query}
        owners={owners}
        now={now}
        loadFailed={!r.ok}
      />
    </div>
  )
}
