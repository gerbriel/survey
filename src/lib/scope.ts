import 'server-only'
import { notFound } from 'next/navigation'
import { requireMember, type MemberContext } from '@/lib/auth'
import type { WorkspaceRole } from '@/types/db-helpers'
import { getContact, type Contact } from '@/lib/db/contacts'
import { getReport, type ReportRow } from '@/lib/db/reports'
import { getResponse, type FullResponse } from '@/lib/db/responses'
import { getSurvey, type SurveyRow } from '@/lib/db/surveys'

/**
 * D-15: ties ids from the URL or action arguments to the workspace in the
 * slug before any other data query, so a wrong-workspace id 404s up front
 * and the URL and the data never disagree. RLS stays the authorization; this
 * also closes the gap if a wrapper is ever switched to the service role.
 *
 * Checks run in order: survey in workspace, then response in that survey
 * (and workspace), contact in workspace, report in survey and workspace.
 * Each failure calls notFound().
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ScopeIds = { surveyId?: string; responseId?: string; contactId?: string; reportId?: string }

export type Scoped = {
  member: MemberContext
  survey?: SurveyRow
  response?: FullResponse
  contact?: Contact
  report?: ReportRow
}

/** Pure ownership rules, unit tested. True when every loaded row belongs where the URL says. */
export function belongsTo(
  workspaceId: string,
  ids: ScopeIds,
  rows: { survey?: { workspace_id: string; id: string } | null; response?: { workspace_id: string; survey_id: string } | null; contact?: { workspace_id: string } | null; report?: { workspace_id: string; survey_id: string } | null },
): boolean {
  if (ids.surveyId && (!rows.survey || rows.survey.workspace_id !== workspaceId || rows.survey.id !== ids.surveyId)) return false
  if (ids.responseId && (!rows.response || rows.response.workspace_id !== workspaceId || (ids.surveyId && rows.response.survey_id !== ids.surveyId))) return false
  if (ids.contactId && (!rows.contact || rows.contact.workspace_id !== workspaceId)) return false
  if (ids.reportId && (!rows.report || rows.report.workspace_id !== workspaceId || (ids.surveyId && rows.report.survey_id !== ids.surveyId))) return false
  return true
}

export async function assertBelongsToWorkspace(slug: string, ids: ScopeIds, minRole: WorkspaceRole = 'viewer'): Promise<Scoped> {
  const member = await requireMember(slug, minRole)
  for (const v of Object.values(ids)) if (v !== undefined && !UUID.test(v)) notFound()
  const wsId = member.workspace.id
  const out: Scoped = { member }
  if (ids.surveyId) {
    const s = await getSurvey(member.supabase, { workspaceId: wsId, surveyId: ids.surveyId })
    if (!s.ok || !s.data) notFound()
    out.survey = s.data
  }
  if (ids.responseId) {
    const r = await getResponse(member.supabase, { responseId: ids.responseId })
    if (!r.ok || !r.data) notFound()
    out.response = r.data
  }
  if (ids.contactId) {
    const c = await getContact(member.supabase, { contactId: ids.contactId })
    if (!c.ok || !c.data) notFound()
    out.contact = c.data
  }
  if (ids.reportId) {
    const r = await getReport(member.supabase, { reportId: ids.reportId })
    if (!r.ok || !r.data) notFound()
    out.report = r.data
  }
  if (!belongsTo(wsId, ids, out)) notFound()
  return out
}
