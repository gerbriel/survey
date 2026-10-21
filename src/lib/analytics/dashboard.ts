import 'server-only'
import type { UserClient } from '@/lib/supabase/types'
import { workspaceDashboardCounts, type DashboardCounts } from '@/lib/db/reports'
import { listSurveysLite, type SurveyLite } from '@/lib/db/surveys'
import { pct } from './stats'

/**
 * Workspace home (doc 04 section 5.3), fixed widgets in v1, all read as the
 * member under RLS through workspaceDashboardCounts in src/lib/db/reports.ts.
 *
 * Decisions: "this week" is the last 7 days rolling, compared with the 7
 * days before. An open survey's completion rate is complete / all responses
 * started in the last 7 days (response based, cheaper than reading events).
 * Recent activity is admin and above (activity_log RLS); others see none.
 */

export type DashboardData = {
  thisWeek: number
  lastWeek: number
  daily: number[]
  openSurveys: { id: string; title: string; responses7d: number; completionRate: number | null }[]
  closingSoon: { id: string; title: string; closes_at: string }[]
  newContactsBySource: { source: string; count: number }[]
  newContacts: number
  leadsByStatus: { status: string; count: number }[]
  followUps: { due: number; overdue: number }
  activity: { id: number; entity: string; action: string; created_at: string }[]
}

const DAY = 86400000
const LEADS = ['new', 'contacted', 'qualified', 'customer', 'lost'] as const

export async function loadDashboard(supabase: UserClient, workspaceId: string, now: Date = new Date()): Promise<DashboardData> {
  const t = now.getTime()
  const surveys = await listSurveysLite(supabase, { workspaceId, order: 'created' })
  const all: SurveyLite[] = surveys.ok ? surveys.data : []
  const open = all.filter((s) => s.state === 'open').slice(0, 10)
  const r = await workspaceDashboardCounts(supabase, { workspaceId, now: t, openSurveyIds: open.map((s) => s.id), leadStatuses: [...LEADS] })
  const c: DashboardCounts = r.ok
    ? r.data
    : { thisWeek: 0, lastWeek: 0, recentSubmittedAt: [], newContactSources: [], followUpsDue: 0, followUpsOverdue: 0, activity: [], leadCounts: [], openSurveyCounts: {} }

  const daily = new Array<number>(14).fill(0)
  for (const at of c.recentSubmittedAt) {
    const i = 13 - Math.floor((t - Date.parse(at)) / DAY)
    if (i >= 0 && i < 14) daily[i]!++
  }

  const openSurveys = open.map((s) => {
    const n = c.openSurveyCounts[s.id] ?? { complete: 0, partial: 0 }
    const total = n.complete + n.partial
    return { id: s.id, title: s.title, responses7d: n.complete, completionRate: total ? pct(n.complete, total) : null }
  })

  const bySource = new Map<string, number>()
  for (const src of c.newContactSources) bySource.set(src || 'Unknown', (bySource.get(src || 'Unknown') ?? 0) + 1)

  return {
    thisWeek: c.thisWeek,
    lastWeek: c.lastWeek,
    daily,
    openSurveys,
    closingSoon: all
      .filter((s) => s.closes_at && Date.parse(s.closes_at) > t && Date.parse(s.closes_at) <= t + 7 * DAY)
      .map((s) => ({ id: s.id, title: s.title, closes_at: s.closes_at! })),
    newContactsBySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    newContacts: c.newContactSources.length,
    leadsByStatus: LEADS.map((s, i) => ({ status: s, count: c.leadCounts[i] ?? 0 })),
    followUps: { due: c.followUpsDue, overdue: c.followUpsOverdue },
    activity: c.activity,
  }
}
