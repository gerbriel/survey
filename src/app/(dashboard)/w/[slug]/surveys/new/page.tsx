import Link from 'next/link'
import { requireMember } from '@/lib/auth'
import { listTemplates } from '@/lib/db/templates'
import { fillTheme } from '@/lib/builder/defaults'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { NewSurvey, type TemplateCard } from '@/components/builder/NewSurvey'

export default async function NewSurveyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const t = await listTemplates(supabase, { workspaceId: workspace.id })
  const templates: TemplateCard[] = (t.ok ? t.data : []).map((x) => ({ id: x.id, name: x.name, description: x.description, system: x.workspace_id === null }))
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
      <NewSurvey workspaceId={workspace.id} base={base} templates={templates} workspaceTheme={fillTheme(workspace.default_theme)} />
    </div>
  )
}
