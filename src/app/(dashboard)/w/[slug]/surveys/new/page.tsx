import Link from 'next/link'
import { requireMember } from '@/lib/auth'
import { listTemplates } from '@/lib/db/templates'
import { fillTheme } from '@/lib/builder/defaults'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { NewSurvey, type TemplateCard } from '@/components/builder/NewSurvey'

export default async function NewSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const created = (await searchParams).created === '1'
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const t = await listTemplates(supabase, { workspaceId: workspace.id })
  const templates: TemplateCard[] = (t.ok ? t.data : []).map((x) => ({ id: x.id, name: x.name, description: x.description, system: x.workspace_id === null, questionCount: x.question_count }))
  const base = `/w/${encodeURIComponent(workspace.slug)}/surveys`
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New survey"
        eyebrow={
          <Link href={base} className="underline">
            Surveys
          </Link>
        }
      />
      {created ? (
        <p role="status" className="mb-4 text-sm text-success">
          Workspace {workspace.name} created. You are its owner; start the first survey here.
        </p>
      ) : null}
      <NewSurvey workspaceId={workspace.id} base={base} templates={templates} workspaceTheme={fillTheme(workspace.default_theme)} />
    </div>
  )
}
