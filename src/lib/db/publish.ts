import { z } from 'zod'
import type { UserClient } from '@/lib/supabase/types'
import { asJson, call, id } from './rpc'
import { definitionObject } from './surveys'

/**
 * Publish (migration 0006, R8, R9). The publish route runs splitDefinition
 * from src/lib/survey and passes the browser-safe half here. SQL re-validates
 * the draft and refuses a public definition that still holds a server-only
 * key (server_only_key_in_public_definition: <key>).
 */
export const publishInput = z.object({
  versionId: id,
  expectedRevision: z.number().int().min(0),
  publicDefinition: definitionObject,
})

/** Returns the id of the new draft version cloned from the published one. */
export function publishSurveyVersion(client: UserClient, input: z.input<typeof publishInput>) {
  return call(
    publishInput,
    input,
    (v) =>
      client.rpc('publish_survey_version', {
        p_version_id: v.versionId,
        p_expected_revision: v.expectedRevision,
        p_public_definition: asJson(v.publicDefinition),
      }),
    (d): string => d as string,
  )
}
