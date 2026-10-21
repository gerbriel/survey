import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserOrAdminClient } from '@/lib/supabase/types'
import { asJson, call, id } from './rpc'

/**
 * Response queries for inbox, reports and exports (migration 0013, doc 04
 * section 4.3). Both functions are SECURITY INVOKER: with a member client RLS
 * limits rows to the caller's workspaces; the service role sees everything.
 */
export type ResponseRow = Tables<'responses'>
export type QuestionRow = Tables<'questions'>

export const responseFilters = z.looseObject({
  from: z.string().optional(),
  to: z.string().optional(),
  /** 'latest' (default), 'all', or a version id. */
  version: z.union([z.literal('latest'), z.literal('all'), id]).optional(),
  status: z.enum(['complete', 'all']).optional(),
  identity: z.enum(['all', 'token', 'identified', 'anonymous']).optional(),
  contact: z
    .object({
      lead_status: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      owner_ids: z.array(id).optional(),
    })
    .optional(),
  answers: z
    .array(
      z.object({
        question_key: z.string(),
        any_of: z.array(z.string()).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
})

export type ResponseFilters = z.input<typeof responseFilters>

export const filteredResponsesInput = z.object({ surveyId: id, filters: responseFilters.default({}) })

export function filteredResponses(client: UserOrAdminClient, input: z.input<typeof filteredResponsesInput>) {
  return call(
    filteredResponsesInput,
    input,
    (v) => client.rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }),
    (rows): ResponseRow[] => (rows ?? []) as ResponseRow[],
  )
}

export const versionQuestionsInput = z.object({ versionId: id })

/** The normalized question snapshot of a published version, in order. */
export function versionQuestions(client: UserOrAdminClient, input: z.input<typeof versionQuestionsInput>) {
  return call(
    versionQuestionsInput,
    input,
    (v) => client.rpc('version_questions', { p_version_id: v.versionId }),
    (rows): QuestionRow[] => (rows ?? []) as QuestionRow[],
  )
}
