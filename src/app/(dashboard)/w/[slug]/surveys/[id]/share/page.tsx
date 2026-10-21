import { getActiveAlias } from '@/lib/builder/queries'
import { loadSurveyContext } from '@/lib/builder/load'
import { publicAssetUrl } from '@/lib/builder/share'
import { effectiveState, stateText, requestTime } from '@/lib/builder/state'
import { SharePanel } from '@/components/builder/SharePanel'

export default async function SharePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const { member, survey, canEdit } = await loadSurveyContext(slug, id)
  const alias = await getActiveAlias(member.supabase, { surveyId: survey.id })
  const publicHost = process.env.PUBLIC_HOST ?? 's.localhost:3000'
  const now = requestTime()
  const eff = effectiveState(survey, now, member.workspace.archived_at !== null)
  return (
    <SharePanel
      surveyId={survey.id}
      slug={survey.slug}
      alias={alias.ok ? alias.data : null}
      publicHost={publicHost}
      logoUrl={publicAssetUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, member.workspace.logo_path)}
      stateText={stateText(survey, now)}
      isPublic={eff.state !== 'draft'}
      canEdit={canEdit}
    />
  )
}
