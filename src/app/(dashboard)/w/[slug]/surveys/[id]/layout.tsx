import Link from 'next/link'
import { loadSurveyContext } from '@/lib/builder/load'
import { stateText, requestTime } from '@/lib/builder/state'
import { Badge } from '@/components/ui/Badge'
import { SurveyTabs } from '@/components/builder/SurveyTabs'

/** Survey header and sub-navigation for every /surveys/[id] page. */
export default async function SurveyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const { survey, base, member } = await loadSurveyContext(slug, id)
  const now = requestTime()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/w/${encodeURIComponent(member.workspace.slug)}/surveys`} className="text-sm text-muted underline">
          Surveys
        </Link>
        <h1 className="text-xl font-semibold">{survey.title}</h1>
        <Badge>{stateText(survey, now)}</Badge>
        {survey.admin_closed_reason ? <Badge tone="danger">Closed by a platform admin: {survey.admin_closed_reason}</Badge> : null}
      </div>
      <SurveyTabs base={base} />
      <div>{children}</div>
    </div>
  )
}
