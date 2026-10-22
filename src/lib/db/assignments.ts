import { z } from 'zod'
import type { UserClient } from '@/lib/supabase/types'
import { fail, makeDbError, ok, type DbResult } from './errors'
import { call, chunks, id, summarizeIssues } from './rpc'

/**
 * Survey assignment (R19, migration 0020). Responsibility metadata, not
 * authorization: who may see or edit a survey is still the workspace role.
 * Members read survey_assignments under RLS; every write is one SQL function
 * (editor and above), which also writes activity_log.
 */

export type AssignmentKind = 'owner' | 'collaborator'

export type AssignmentRow = {
  survey_id: string
  user_id: string
  kind: AssignmentKind
  assigned_at: string
  display_name: string
  avatar_url: string | null
}

export const assignInput = z.object({ surveyId: id, userId: id })

/** Editor and above. The previous owner stays on as a collaborator. Raises assignee_not_member. */
export function setSurveyOwner(client: UserClient, input: z.input<typeof assignInput>) {
  return call(
    assignInput,
    input,
    (v) => client.rpc('set_survey_owner', { p_survey_id: v.surveyId, p_user_id: v.userId }),
    () => undefined,
  )
}

/** Editor and above. A no-op for an existing collaborator; invalid_target for the owner. */
export function addSurveyCollaborator(client: UserClient, input: z.input<typeof assignInput>) {
  return call(
    assignInput,
    input,
    (v) => client.rpc('add_survey_collaborator', { p_survey_id: v.surveyId, p_user_id: v.userId }),
    () => undefined,
  )
}

/** Editor and above. A no-op when the person is not a collaborator; invalid_target for the owner. */
export function removeSurveyCollaborator(client: UserClient, input: z.input<typeof assignInput>) {
  return call(
    assignInput,
    input,
    (v) => client.rpc('remove_survey_collaborator', { p_survey_id: v.surveyId, p_user_id: v.userId }),
    () => undefined,
  )
}

const COLS = 'survey_id, user_id, kind, assigned_at, profile:profiles!survey_assignments_user_id_fkey(display_name, avatar_url)'

type RawRow = {
  survey_id: string
  user_id: string
  kind: string
  assigned_at: string
  profile: { display_name: string; avatar_url: string | null } | null
}

function toRow(r: RawRow): AssignmentRow {
  return {
    survey_id: r.survey_id,
    user_id: r.user_id,
    kind: r.kind === 'owner' ? 'owner' : 'collaborator',
    assigned_at: r.assigned_at,
    display_name: r.profile?.display_name ?? 'Unknown user',
    avatar_url: r.profile?.avatar_url ?? null,
  }
}

export const surveyAssignmentsInput = z.object({ surveyId: id })

/** Owner and collaborators of one survey, owner first, then by name. */
export function listSurveyAssignments(client: UserClient, input: z.input<typeof surveyAssignmentsInput>) {
  return call(
    surveyAssignmentsInput,
    input,
    (v) => client.from('survey_assignments').select(COLS).eq('survey_id', v.surveyId),
    (rows): AssignmentRow[] => sortAssignments(((rows ?? []) as RawRow[]).map(toRow)),
  )
}

export const assignmentsForSurveysInput = z.object({ surveyIds: z.array(id).max(1000) })

/** Assignments of many surveys (the list page), read 100 ids per request to keep URLs short. */
export async function listAssignmentsForSurveys(
  client: UserClient,
  input: z.input<typeof assignmentsForSurveysInput>,
): Promise<DbResult<AssignmentRow[]>> {
  const parsed = assignmentsForSurveysInput.safeParse(input)
  if (!parsed.success) return fail(makeDbError('invalid_input', summarizeIssues(parsed.error)))
  const out: AssignmentRow[] = []
  for (const ids of chunks(parsed.data.surveyIds, 100)) {
    const r = await call(
      assignmentsForSurveysInput,
      { surveyIds: ids },
      (v) => client.from('survey_assignments').select(COLS).in('survey_id', v.surveyIds),
      (rows): AssignmentRow[] => ((rows ?? []) as RawRow[]).map(toRow),
    )
    if (!r.ok) return fail(r.error)
    out.push(...r.data)
  }
  return ok(sortAssignments(out))
}

// ---------------------------------------------------------------------------
// Pure helpers for the list page, unit tested.
// ---------------------------------------------------------------------------

export function sortAssignments(rows: AssignmentRow[]): AssignmentRow[] {
  return [...rows].sort((a, b) =>
    a.kind === b.kind ? a.display_name.localeCompare(b.display_name) : a.kind === 'owner' ? -1 : 1,
  )
}

export type SurveyPeople = { owner: AssignmentRow | null; collaborators: AssignmentRow[] }

/** Assignments grouped per survey id. */
export function groupAssignments(rows: AssignmentRow[]): Map<string, SurveyPeople> {
  const out = new Map<string, SurveyPeople>()
  for (const r of sortAssignments(rows)) {
    const g = out.get(r.survey_id) ?? { owner: null, collaborators: [] }
    if (r.kind === 'owner') g.owner = r
    else g.collaborators.push(r)
    out.set(r.survey_id, g)
  }
  return out
}

export const ASSIGNMENT_FILTERS = ['all', 'mine', 'owned', 'unassigned'] as const
export type AssignmentFilter = (typeof ASSIGNMENT_FILTERS)[number]

/** Query param value to a filter; anything unknown is `all`. */
export function readAssignmentFilter(value: unknown): AssignmentFilter {
  return typeof value === 'string' && (ASSIGNMENT_FILTERS as readonly string[]).includes(value) ? (value as AssignmentFilter) : 'all'
}

/**
 * Decision: "Assigned to me" means owner or collaborator; "Unassigned" means
 * the survey has no owner (collaborators alone do not make it assigned).
 */
export function matchesAssignmentFilter(filter: AssignmentFilter, people: SurveyPeople | undefined, userId: string): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'owned':
      return people?.owner?.user_id === userId
    case 'mine':
      return people?.owner?.user_id === userId || (people?.collaborators.some((c) => c.user_id === userId) ?? false)
    case 'unassigned':
      return !people?.owner
  }
}
