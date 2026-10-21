import 'server-only'
import {
  diffDefinitions,
  lintDefinition,
  safeMigrateDefinition,
  splitDefinition,
  type LintOptions,
  type SurveyDefinition,
} from '@/lib/survey'
import { saveDraft, getSurvey, getVersion } from '@/lib/db/surveys'
import { publishSurveyVersion } from '@/lib/db/publish'
import { fail, makeDbError, ok, type DbResult } from '@/lib/db/errors'
import type { UserClient } from '@/lib/supabase/types'
import { loadDefinition } from './defaults'
import type { PublishOutcome } from './types'

/**
 * Publish (doc 03 section 7, R8, R9). Never uses the admin client.
 *
 *  1. Validate the shape and run the lint pass; errors block.
 *  2. Diff against the latest published version; breaking changes on a
 *     survey with responses need the caller's acknowledgment.
 *  3. Save the definition through the revision-guarded save_draft, because
 *     publish_survey_version validates the stored draft row.
 *  4. splitDefinition, then publish_survey_version with the new revision and
 *     the browser-safe half.
 *
 * Publishing never changes survey state (doc 02 section 3).
 */
export async function publishDraft(
  client: UserClient,
  input: {
    surveyId: string
    versionId: string
    expectedRevision: number
    definition: unknown
    acknowledgeBreaking: boolean
    lint?: LintOptions
  },
): Promise<DbResult<PublishOutcome>> {
  const migrated = safeMigrateDefinition(input.definition)
  if (!migrated.ok) return fail(makeDbError('invalid_definition', migrated.issues.slice(0, 3).join('; ')))
  const def = migrated.definition

  const lint = lintDefinition(def, input.lint)
  if (!lint.ok) return ok({ status: 'lint_failed', issues: lint.issues })

  const survey = await getSurvey(client, { surveyId: input.surveyId })
  if (!survey.ok) return fail(survey.error)
  if (!survey.data) return fail(makeDbError('not_found'))
  if (survey.data.current_draft_version_id !== input.versionId) return fail(makeDbError('not_draft'))

  const prev = await previousDefinition(client, survey.data.latest_published_version_id)
  if (prev && survey.data.complete_count > 0 && !input.acknowledgeBreaking) {
    const diff = diffDefinitions(prev, def)
    if (diff.has_breaking) return ok({ status: 'needs_ack', diff })
  }

  const saved = await saveDraft(client, { versionId: input.versionId, expectedRevision: input.expectedRevision, definition: def as unknown as { pages: unknown[] } })
  if (!saved.ok) return fail(saved.error)

  const { public_definition } = splitDefinition(def)
  const published = await publishSurveyVersion(client, {
    versionId: input.versionId,
    expectedRevision: saved.data,
    publicDefinition: public_definition as unknown as { pages: unknown[] },
  })
  if (!published.ok) return fail(published.error)

  const fresh = await getVersion(client, { versionId: published.data })
  return ok({
    status: 'published',
    newDraftVersionId: published.data,
    revision: fresh.ok && fresh.data ? fresh.data.revision : 0,
    versionNo: fresh.ok && fresh.data ? fresh.data.version_no - 1 : null,
  })
}

/** Latest published definition, normalized for diffing; null before the first publish. */
export async function previousDefinition(client: UserClient, versionId: string | null): Promise<SurveyDefinition | null> {
  if (!versionId) return null
  const v = await getVersion(client, { versionId })
  if (!v.ok || !v.data) return null
  const loaded = loadDefinition(v.data.definition)
  return loaded.ok ? loaded.definition : null
}
