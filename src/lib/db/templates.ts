import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { asJsonObject, call, id } from './rpc'

/**
 * Survey templates (doc 03 section 9). RLS: system templates (workspace_id
 * null) are readable by everyone signed in; workspace templates by members,
 * written by editors. create_survey copies a template's definition.
 */
export type TemplateRow = Tables<'survey_templates'>
export type TemplateSummary = Pick<TemplateRow, 'id' | 'workspace_id' | 'name' | 'description' | 'created_at'> & {
  /** Number of entries in definition.questions, for the new survey cards. */
  question_count: number
}

/** Count of keys in a template's `definition->questions` JSON. Pure. */
export function countTemplateQuestions(questions: unknown): number {
  return questions && typeof questions === 'object' && !Array.isArray(questions) ? Object.keys(questions).length : 0
}

export const listTemplatesInput = z.object({ workspaceId: id })

/** System templates and the workspace's own, by name. */
export function listTemplates(client: UserClient, input: z.input<typeof listTemplatesInput>) {
  return call(
    listTemplatesInput,
    input,
    (v) =>
      client
        .from('survey_templates')
        .select('id, workspace_id, name, description, created_at, questions:definition->questions')
        .or(`workspace_id.is.null,workspace_id.eq.${v.workspaceId}`)
        .order('name'),
    (rows): TemplateSummary[] =>
      (rows ?? []).map(({ questions, ...t }) => ({ ...t, question_count: countTemplateQuestions(questions) })),
  )
}

export const insertTemplateInput = z.object({
  workspaceId: id,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  definition: z.looseObject({ pages: z.array(z.unknown()) }),
  createdBy: id,
})

/** "Save as template". Returns the new template id. */
export function insertTemplate(client: UserClient, input: z.input<typeof insertTemplateInput>) {
  return call(
    insertTemplateInput,
    input,
    (v) =>
      client
        .from('survey_templates')
        .insert({
          workspace_id: v.workspaceId,
          name: v.name,
          description: v.description || null,
          definition: asJsonObject(v.definition),
          created_by: v.createdBy,
        })
        .select('id')
        .single(),
    (row): string => row?.id ?? '',
  )
}
