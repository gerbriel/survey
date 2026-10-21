import 'server-only'
import type { UserClient } from '@/lib/supabase/types'
import { listSurveys, type SurveyLite } from './data'
import { pct } from './stats'

/**
 * Workspace home (doc 04 section 5.3), fixed widgets in v1, all read as the
 * member under RLS. TODO(foundation): these counts belong in src/lib/db or a
 * SQL function; they are a handful of head-count queries here.
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
  const iso = (ms: number) => new Date(ms).toISOString()
  const today = iso(t).slice(0, 10)
  const head = { count: 'exact' as const, head: true }

  const responsesBetween = (from: number, to: number) =>
    supabase.from('responses').select('id', head).eq('workspace_id', workspaceId).eq('status', 'complete').gte('submitted_at', iso(from)).lt('submitted_at', iso(to))

  const [thisWeek, lastWeek, recent, surveys, contacts, followDue, followOver, activity, ...leads] = await Promise.all([
    responsesBetween(t - 7 * DAY, t),
    responsesBetween(t - 14 * DAY, t - 7 * DAY),
    supabase.from('responses').select('submitted_at').eq('workspace_id', workspaceId).eq('status', 'complete').gte('submitted_at', iso(t - 14 * DAY)).limit(1000),
    listSurveys(supabase, { workspaceId }),
    supabase.from('contacts').select('source').eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null).gte('created_at', iso(t - 7 * DAY)).limit(1000),
    supabase.from('contacts').select('id', head).eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null).eq('follow_up_at', today),
    supabase.from('contacts').select('id', head).eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null).lt('follow_up_at', today),
    supabase.from('activity_log').select('id, entity, action, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(10),
    ...LEADS.map((s) => supabase.from('contacts').select('id', head).eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null).eq('lead_status', s)),
  ])

  const daily = new Array<number>(14).fill(0)
  for (const r of recent.data ?? []) {
    if (!r.submitted_at) continue
    const i = 13 - Math.floor((t - Date.parse(r.submitted_at)) / DAY)
    if (i >= 0 && i < 14) daily[i]!++
  }

  const all: SurveyLite[] = surveys.ok ? surveys.data : []
  const open = all.filter((s) => s.state === 'open').slice(0, 10)
  const openSurveys = await Promise.all(
    open.map(async (s) => {
      const [c, p] = await Promise.all([
        supabase.from('responses').select('id', head).eq('survey_id', s.id).eq('status', 'complete').gte('started_at', iso(t - 7 * DAY)),
        supabase.from('responses').select('id', head).eq('survey_id', s.id).eq('status', 'partial').gte('started_at', iso(t - 7 * DAY)),
      ])
      const done = c.count ?? 0
      const total = done + (p.count ?? 0)
      return { id: s.id, title: s.title, responses7d: done, completionRate: total ? pct(done, total) : null }
    }),
  )

  const bySource = new Map<string, number>()
  for (const c of contacts.data ?? []) bySource.set(c.source || 'Unknown', (bySource.get(c.source || 'Unknown') ?? 0) + 1)

  return {
    thisWeek: thisWeek.count ?? 0,
    lastWeek: lastWeek.count ?? 0,
    daily,
    openSurveys,
    closingSoon: all
      .filter((s) => s.closes_at && Date.parse(s.closes_at) > t && Date.parse(s.closes_at) <= t + 7 * DAY)
      .map((s) => ({ id: s.id, title: s.title, closes_at: s.closes_at! })),
    newContactsBySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    newContacts: (contacts.data ?? []).length,
    leadsByStatus: LEADS.map((s, i) => ({ status: s, count: leads[i]?.count ?? 0 })),
    followUps: { due: followDue.count ?? 0, overdue: followOver.count ?? 0 },
    activity: activity.data ?? [],
  }
}
