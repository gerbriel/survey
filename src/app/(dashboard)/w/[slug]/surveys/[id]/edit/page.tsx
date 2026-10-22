import { loadSurveyContext } from '@/lib/builder/load'
import { getVersion } from '@/lib/db/surveys'
import { listContactFields } from '@/lib/db/contacts'
import { listPixelSummaries } from '@/lib/db/pixels'
import { fillTheme, loadDefinition } from '@/lib/builder/defaults'
import { previousDefinition } from '@/lib/builder/publish'
import { publicAssetUrl } from '@/lib/builder/share'
import { stateText, requestTime } from '@/lib/builder/state'
import { EmptyState } from '@/components/ui/EmptyState'
import { Builder } from '@/components/builder/Builder'

export default async function EditPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const { member, survey, canEdit, base } = await loadSurveyContext(slug, id)
  const client = member.supabase
  const ws = member.workspace
  if (!survey.current_draft_version_id) return <EmptyState title="This survey has no draft" description="Contact a workspace admin." />
  const [draft, published, fields, pixels] = await Promise.all([
    getVersion(client, { versionId: survey.current_draft_version_id }),
    previousDefinition(client, survey.latest_published_version_id),
    listContactFields(client, { workspaceId: ws.id }),
    listPixelSummaries(client, { workspaceId: ws.id }),
  ])
  if (!draft.ok || !draft.data) return <EmptyState title="The draft could not be loaded" description={draft.ok ? undefined : draft.error.message} />
  const workspaceTheme = fillTheme(ws.default_theme)
  const loaded = loadDefinition(draft.data.definition, workspaceTheme)
  if (!loaded.ok) {
    return <EmptyState title="The draft could not be read" description={loaded.issues.slice(0, 3).join('; ')} />
  }
  const excluded = new Set(survey.excluded_pixel_ids)
  const now = requestTime()
  return (
    <Builder
      surveyId={survey.id}
      workspaceId={ws.id}
      basePath={base}
      versionId={draft.data.id}
      revision={draft.data.revision}
      definition={loaded.definition}
      publishedDefinition={published}
      // Decision: keys of the latest published version stand in for "ever published" keys.
      publishedKeys={published ? Object.values(published.questions).map((q) => q.question_key) : []}
      completeCount={survey.complete_count}
      stateLabel={stateText(survey, now)}
      canEdit={canEdit}
      workspaceTheme={workspaceTheme}
      logoUrl={publicAssetUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, ws.logo_path) ?? undefined}
      imageUploadUrl={canEdit ? `/w/${encodeURIComponent(ws.slug)}/settings/images/upload` : null}
      contactFields={fields.ok ? fields.data.map((f) => ({ key: f.key, label: f.label })) : []}
      pixelConsentMode={ws.pixel_consent_mode}
      loadsPixels={pixels.ok && pixels.data.some((p) => p.enabled && !excluded.has(p.id))}
    />
  )
}
