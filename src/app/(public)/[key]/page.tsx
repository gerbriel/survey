import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { generateResponseSeed, type RichText, type Theme } from '@/lib/survey'
import { richTextPlain } from '@/components/survey/renderer'
import { loadPublicSurvey, publicAssetUrl, publicOrigin, surveyContext } from '@/lib/public/load'
import { pixelsFor } from '@/lib/public/pixels'
import { MAX_FILES_PER_RESPONSE } from '@/lib/public/uploads'
import { themeFonts } from '@/components/public/fonts'
import { PublicFooter } from '@/components/public/PublicFooter'
import { ClosedStateScreen, ScheduledScreen } from '@/components/public/StateScreens'
import { SurveyClient } from './SurveyClient'

/**
 * Public survey page (doc 02 sections 3, 4 and 10). State per request with
 * the anon client, the definition from a cache by version id. Draft and
 * unknown keys are the same 404. Scheduled and closed render a state screen
 * and send no questions. Open hands the browser-safe definition to the
 * client wrapper around the renderer.
 */

type Props = { params: Promise<{ key: string }> }

const NOINDEX = { index: false, follow: false } as const

function introText(definition: unknown): string | undefined {
  const d = (definition as { settings?: { description?: RichText } } | null)?.settings?.description
  if (!d) return undefined
  const plain = richTextPlain(d)
  return plain ? plain.slice(0, 160) : undefined
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params
  const loaded = await loadPublicSurvey(key)
  if (loaded.kind === 'not_found') return { title: 'Survey not found', robots: NOINDEX }
  const s = loaded.survey
  const title = s.og_title || s.title
  const description = s.og_description || (loaded.kind === 'open' ? introText(loaded.definition) : undefined)
  // L7: the card route checks the survey's state by key, so the key travels with the version id.
  const image = publicAssetUrl(s.og_image_path) ?? (s.version_id ? `/api/public/og/${s.version_id}?k=${encodeURIComponent(key.toLowerCase())}` : null)
  return {
    metadataBase: new URL(publicOrigin()),
    title: s.title,
    description,
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${key}`,
      images: image ? [{ url: image, width: 1200, height: 630 }] : undefined,
    },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : undefined },
    // Unfurlers ignore noindex, so link previews still work (doc 02 section 4).
    robots: s.allow_indexing ? { index: true, follow: true } : NOINDEX,
  }
}

export default async function SurveyPage({ params }: Props) {
  const { key } = await params
  const loaded = await loadPublicSurvey(key)
  if (loaded.kind === 'not_found') notFound()
  const s = loaded.survey
  const logoUrl = publicAssetUrl(s.logo_path)
  const footer = (
    <PublicFooter
      slug={s.slug}
      workspaceName={s.workspace_name}
      privacyNoticeUrl={s.privacy_notice_url}
      showPoweredBy={s.show_powered_by}
      newTab={loaded.kind === 'open'}
    />
  )

  if (loaded.kind === 'state') {
    if (s.effective_state === 'scheduled') {
      return <ScheduledScreen title={s.title} opensAt={s.opens_at} logoUrl={logoUrl} footer={footer} />
    }
    return <ClosedStateScreen title={s.title} message={s.closed_message} logoUrl={logoUrl} footer={footer} />
  }

  const ctx = await surveyContext(s)
  const { pixels, mode } = await pixelsFor(s, loaded.definition, ctx)
  const fonts = themeFonts((loaded.definition as { theme?: Theme } | null)?.theme)
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')

  return (
    <>
      <style>{fonts.css}</style>
      <SurveyClient
        surveyKey={key}
        surveyId={s.survey_id}
        versionId={loaded.survey.version_id}
        workspaceId={s.workspace_id}
        workspaceName={s.workspace_name}
        definition={loaded.definition}
        serverSeed={generateResponseSeed()}
        title={s.title}
        closedMessage={s.closed_message}
        logoUrl={logoUrl ?? undefined}
        assetBase={supabase ? `${supabase}/storage/v1/object/public/public-assets` : null}
        fontClassName={fonts.className}
        pixels={pixels}
        consentMode={mode}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
        maxFiles={Math.min(ctx?.limits.max_files_per_response ?? MAX_FILES_PER_RESPONSE, MAX_FILES_PER_RESPONSE)}
        publicOrigin={publicOrigin()}
        footer={footer}
      />
    </>
  )
}
