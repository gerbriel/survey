import { getVersion } from '@/lib/db/surveys'
import { listPixelSummaries } from '@/lib/db/pixels'
import { loadSurveyContext } from '@/lib/builder/load'
import { loadDefinition } from '@/lib/builder/defaults'
import { stateText, requestTime } from '@/lib/builder/state'
import { SettingsForm } from '@/components/builder/SettingsForm'

export default async function SurveySettingsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const { member, survey, canEdit, base } = await loadSurveyContext(slug, id)
  const pixels = await listPixelSummaries(member.supabase, { workspaceId: member.workspace.id })
  let identityText = 'No identity question. Responses are not matched to contacts by email.'
  if (survey.current_draft_version_id) {
    const v = await getVersion(member.supabase, { versionId: survey.current_draft_version_id })
    const d = v.ok && v.data ? loadDefinition(v.data.definition) : null
    if (d?.ok) {
      const q = d.definition.identity.email_question_id ? d.definition.questions[d.definition.identity.email_question_id] : undefined
      if (q) identityText = `Responses are matched to contacts by the answer to "${q.label.text}" (in the current draft).`
    }
  }
  const now = requestTime()
  return (
    <SettingsForm
      surveyId={survey.id}
      workspaceId={member.workspace.id}
      published={survey.latest_published_version_id !== null}
      pixels={pixels.ok ? pixels.data : []}
      canEdit={canEdit}
      editHref={`${base}/edit`}
      identityText={identityText}
      trustHidden={survey.trust_hidden_identity}
      stateText={stateText(survey, now)}
      initial={{
        state: survey.state,
        opens_at: survey.opens_at,
        closes_at: survey.closes_at,
        closed_message: survey.closed_message,
        response_cap: survey.response_cap,
        excluded_pixel_ids: survey.excluded_pixel_ids,
        og_title: survey.og_title,
        og_description: survey.og_description,
        og_image_path: survey.og_image_path,
        allow_indexing: survey.allow_indexing,
      }}
    />
  )
}
