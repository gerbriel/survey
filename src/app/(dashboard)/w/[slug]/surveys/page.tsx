import Link from 'next/link'
import { requireMember, memberCan } from '@/lib/auth'
import { listSurveys } from '@/lib/db/surveys'
import { effectiveState, stateText, requestTime } from '@/lib/builder/state'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SurveyList, type SurveyListRow } from '@/components/builder/SurveyList'

export default async function SurveysPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ archived?: string }> }) {
  const { slug } = await params
  const { archived } = await searchParams
  const { supabase, workspace, role } = await requireMember(slug, 'viewer')
  const canEdit = memberCan(role, 'editor', workspace)
  const archivedView = archived === '1'
  const r = await listSurveys(supabase, { workspaceId: workspace.id, archived: archivedView })
  const now = requestTime()
  const rows: SurveyListRow[] = (r.ok ? r.data : []).map((s) => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
    state: effectiveState(s, now, workspace.archived_at !== null).state,
    stateText: stateText(s, now),
    responses: s.complete_count,
    cap: s.response_cap,
    updatedAt: s.updated_at,
    archived: s.archived_at !== null,
  }))
  const base = `/w/${encodeURIComponent(workspace.slug)}/surveys`
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
          {r.error.message}
        </p>
      ) : null}
      <SurveyList rows={rows} base={base} canEdit={canEdit} archivedView={archivedView} />
    </div>
  )
}
