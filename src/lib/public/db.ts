import 'server-only'
import { z } from 'zod'
import { call, id } from '@/lib/db/rpc'
import type { DbResult } from '@/lib/db/errors'
import type { AdminClient } from '@/lib/supabase/types'
import type { Json } from '@/types/db-helpers'

/**
 * Service-role table reads and one insert that Phase 2C needs and that
 * src/lib/db (frozen) does not wrap yet. Same contract as src/lib/db: zod
 * input, one query, DbResult out, never throws.
 *
 * TODO(foundation change request): move these into src/lib/db/submission.ts
 * (surveyWorkspace, publishedVersion, resumeState), src/lib/db/admin.ts
 * (insertAbuseReport, privacyNotice) and src/lib/db/publicRead.ts (ogCard).
 */

export function surveyWorkspace(admin: AdminClient, input: { surveyId: string }) {
  return call(
    z.object({ surveyId: id }),
    input,
    (v) => admin.from('surveys').select('id, workspace_id').eq('id', v.surveyId).maybeSingle(),
    (row): { id: string; workspace_id: string } | null => row ?? null,
  )
}

export type PublishedVersion = {
  id: string
  survey_id: string
  workspace_id: string
  version_no: number
  definition: Json
}

/** The full (server-only) definition of a published version of the survey. */
export function publishedVersion(admin: AdminClient, input: { versionId: string; surveyId: string }) {
  return call(
    z.object({ versionId: id, surveyId: id }),
    input,
    (v) =>
      admin
        .from('survey_versions')
        .select('id, survey_id, workspace_id, version_no, definition')
        .eq('id', v.versionId)
        .eq('survey_id', v.surveyId)
        .eq('status', 'published')
        .maybeSingle(),
    (row): PublishedVersion | null => (row ? (row as PublishedVersion) : null),
  )
}

export type ResumeRows = {
  response: {
    id: string
    survey_version_id: string
    metadata: Json
    last_question_key: string | null
    started_at: string
  }
  answers: {
    question_key: string
    value_text: string | null
    value_number: number | null
    value_date: string | null
    value_json: Json | null
  }[]
  files: { id: string; question_key: string; object_path: string; original_name: string; declared_size: number; declared_mime: string }[]
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

/** An open partial by resume hash, with its answers and files. Null when unknown or complete. */
export async function resumeState(
  admin: AdminClient,
  input: { surveyId: string; resumeTokenHash: string },
): Promise<DbResult<ResumeRows | null>> {
  const head = await call(
    z.object({ surveyId: id, resumeTokenHash: sha256Hex }),
    input,
    (v) =>
      admin
        .from('responses')
        .select('id, survey_version_id, metadata, last_question_key, started_at')
        .eq('survey_id', v.surveyId)
        .eq('resume_token_hash', v.resumeTokenHash)
        .eq('status', 'partial')
        .maybeSingle(),
  )
  if (!head.ok) return head
  if (!head.data) return { ok: true, data: null }
  const response = head.data as ResumeRows['response']
  const answers = await call(
    z.object({ responseId: id }),
    { responseId: response.id },
    (v) =>
      admin
        .from('answers')
        .select('question_key, value_text, value_number, value_date, value_json')
        .eq('response_id', v.responseId),
  )
  if (!answers.ok) return answers
  const files = await call(
    z.object({ responseId: id }),
    { responseId: response.id },
    (v) =>
      admin
        .from('response_files')
        .select('id, question_key, object_path, original_name, declared_size, declared_mime')
        .eq('response_id', v.responseId)
        .order('created_at'),
  )
  if (!files.ok) return files
  return {
    ok: true,
    data: {
      response,
      answers: (answers.data ?? []) as ResumeRows['answers'],
      files: (files.data ?? []) as ResumeRows['files'],
    },
  }
}

/** Matches the abuse_reports.reason check constraint (migration 0010). */
export const ABUSE_REASONS = ['phishing', 'sensitive_data', 'harassment', 'other'] as const

export const abuseReportInput = z.object({
  survey_id: id.nullable(),
  workspace_id: id.nullable(),
  slug_text: z.string().max(100),
  reason: z.enum(ABUSE_REASONS),
  details: z.string().max(2000).nullable(),
  reporter_contact: z.string().max(200).nullable(),
  ip_hash: z.string().max(64).nullable(),
})

export function insertAbuseReport(admin: AdminClient, input: z.input<typeof abuseReportInput>) {
  return call(
    abuseReportInput,
    input,
    (v) => admin.from('abuse_reports').insert(v),
    () => undefined,
  )
}

/** The organization privacy notice markdown (platform_settings singleton). */
export function privacyNotice(admin: AdminClient) {
  return call(
    z.object({}),
    {},
    () => admin.from('platform_settings').select('privacy_notice_md, updated_at').eq('id', true).maybeSingle(),
    (row): { markdown: string; updatedAt: string | null } => ({
      markdown: row?.privacy_notice_md ?? '',
      updatedAt: row?.updated_at ?? null,
    }),
  )
}

export type OgCard = { title: string; workspaceName: string; logoPath: string | null }

/** Title and workspace branding for a published version, or null. */
export function ogCard(admin: AdminClient, input: { versionId: string }) {
  return call(
    z.object({ versionId: id }),
    input,
    (v) =>
      admin
        .from('survey_versions')
        .select('public_definition, status, surveys!inner(title, archived_at), workspaces!inner(name, logo_path, deleted_at)')
        .eq('id', v.versionId)
        .eq('status', 'published')
        .maybeSingle(),
    (row): OgCard | null => {
      if (!row) return null
      const r = row as unknown as {
        public_definition: { settings?: { title?: unknown } } | null
        surveys: { title: string; archived_at: string | null } | null
        workspaces: { name: string; logo_path: string | null; deleted_at: string | null } | null
      }
      if (!r.workspaces || r.workspaces.deleted_at || !r.surveys || r.surveys.archived_at) return null
      const t = r.public_definition?.settings?.title
      return {
        title: typeof t === 'string' && t.trim() ? t : r.surveys.title,
        workspaceName: r.workspaces.name,
        logoPath: r.workspaces.logo_path,
      }
    },
  )
}
