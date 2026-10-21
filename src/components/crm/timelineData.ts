import type { SurveyDefinition } from '@/lib/survey'
import { previewAnswers, type StoredAnswer } from '@/components/responses/answers'
import { STATUS_LABELS } from './types'

/**
 * Builds the contact timeline (doc 04 section 1.3): every response across
 * every survey, notes, and CRM events from activity_log, newest first.
 *
 * Decision: activity_log is readable by admins only (RLS), so editors and
 * viewers see responses and notes; admins also see status, owner, merge and
 * other contact events.
 */
export type TimelineItem =
  | {
      kind: 'response'
      id: string
      at: string
      surveyId: string
      surveyTitle: string
      versionNo: number | null
      status: 'partial' | 'complete'
      identitySource: string | null
      preview: { label: string; text: string }[]
      href: string
    }
  | { kind: 'note'; id: string; at: string; author: string; body: string }
  | { kind: 'activity'; id: string; at: string; text: string }

export type TimelineInput = {
  slug: string
  responses: {
    id: string
    survey_id: string
    survey_version_id: string
    status: 'partial' | 'complete'
    identity_source: string | null
    started_at: string
    submitted_at: string | null
    survey: { title: string } | null
  }[]
  answers: (StoredAnswer & { response_id: string })[]
  versions: Map<string, { version_no: number; def: SurveyDefinition | null }>
  notes: { id: string; created_at: string; author: string | null; body: string }[]
  activity: { id: number; created_at: string; action: string; diff: unknown }[]
  authorName: (id: string | null) => string
}

function pair(diff: unknown, key: string): [unknown, unknown] | null {
  if (!diff || typeof diff !== 'object') return null
  const v = (diff as Record<string, unknown>)[key]
  return Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : null
}

export function activityText(action: string, diff: unknown, authorName: (id: string | null) => string): string | null {
  switch (action) {
    case 'status_change': {
      const p = pair(diff, 'lead_status')
      return p ? `Status changed from ${STATUS_LABELS[String(p[0])] ?? p[0]} to ${STATUS_LABELS[String(p[1])] ?? p[1]}` : 'Status changed'
    }
    case 'owner_change': {
      const p = pair(diff, 'owner_id')
      return p ? `Owner changed from ${authorName(p[0] as string | null)} to ${authorName(p[1] as string | null)}` : 'Owner changed'
    }
    case 'merge': {
      const merged = (diff as { merged?: unknown[] } | null)?.merged
      return `Merged ${Array.isArray(merged) ? merged.length : 'other'} contact${Array.isArray(merged) && merged.length === 1 ? '' : 's'} into this one`
    }
    case 'create':
      return 'Contact created'
    case 'update': {
      const keys = diff && typeof diff === 'object' ? Object.keys(diff as object) : []
      return keys.length ? `Updated ${keys.map((k) => k.replace(/_/g, ' ')).join(', ')}` : 'Updated'
    }
    case 'gdpr_export':
      return 'Personal data exported'
    case 'erase':
      return 'Personal data erased'
    default:
      return action.startsWith('note.') ? null : action.replace(/[_.]/g, ' ')
  }
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const byResponse = new Map<string, StoredAnswer[]>()
  for (const a of input.answers) {
    const list = byResponse.get(a.response_id) ?? []
    list.push(a)
    byResponse.set(a.response_id, list)
  }
  const items: TimelineItem[] = []
  for (const r of input.responses) {
    const v = input.versions.get(r.survey_version_id)
    items.push({
      kind: 'response',
      id: r.id,
      at: r.submitted_at ?? r.started_at,
      surveyId: r.survey_id,
      surveyTitle: r.survey?.title ?? 'Survey',
      versionNo: v?.version_no ?? null,
      status: r.status,
      identitySource: r.identity_source,
      preview: previewAnswers(v?.def ?? null, byResponse.get(r.id) ?? [], 3),
      href: `/w/${input.slug}/surveys/${r.survey_id}/responses/${r.id}`,
    })
  }
  for (const n of input.notes) {
    items.push({ kind: 'note', id: n.id, at: n.created_at, author: input.authorName(n.author), body: n.body })
  }
  for (const a of input.activity) {
    const text = activityText(a.action, a.diff, input.authorName)
    if (text) items.push({ kind: 'activity', id: String(a.id), at: a.created_at, text })
  }
  return items.sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1))
}

export type SurveyGroup = { surveyId: string; title: string; items: Extract<TimelineItem, { kind: 'response' }>[] }

export function groupBySurvey(items: TimelineItem[]): SurveyGroup[] {
  const groups = new Map<string, SurveyGroup>()
  for (const i of items) {
    if (i.kind !== 'response') continue
    const g = groups.get(i.surveyId) ?? { surveyId: i.surveyId, title: i.surveyTitle, items: [] }
    g.items.push(i)
    groups.set(i.surveyId, g)
  }
  return [...groups.values()]
}
