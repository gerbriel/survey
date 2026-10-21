import 'server-only'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requireMember, memberCan, type MemberContext } from '@/lib/auth'
import { getSurvey, type SurveyRow } from '@/lib/db/surveys'

/**
 * Member plus survey for the /w/[slug]/surveys/[id] pages. 404 when the
 * survey is missing, hidden by RLS, or in another workspace. UX only; RLS
 * is the authorization.
 */
export const loadSurveyContext = cache(async (slug: string, surveyId: string): Promise<{ member: MemberContext; survey: SurveyRow; canEdit: boolean; base: string }> => {
  const member = await requireMember(slug, 'viewer')
  if (!/^[0-9a-f-]{36}$/i.test(surveyId)) notFound()
  const s = await getSurvey(member.supabase, { surveyId })
  if (!s.ok || !s.data || s.data.workspace_id !== member.workspace.id) notFound()
  return {
    member,
    survey: s.data,
    canEdit: memberCan(member.role, 'editor', member.workspace),
    base: `/w/${encodeURIComponent(member.workspace.slug)}/surveys/${s.data.id}`,
  }
})
