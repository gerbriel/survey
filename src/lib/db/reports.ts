import { z } from 'zod'
import type { Json } from '@/types/db-helpers'
import type { AdminClient } from '@/lib/supabase/types'
import { call } from './rpc'

/**
 * Public shared report payload (migration 0013, doc 04 section 5.4). Service
 * role only: the /r/[token] page on the public host calls it through server
 * library code. Returns aggregates only, cells under 3 suppressed, and null for
 * an unknown, revoked or expired token or a wrong password, so the page can
 * answer the same 404 for all of them. Saved reports, widgets and shares are
 * table rows under RLS (editor and above).
 */
export type SharedReportWidget = {
  id: string
  position: number
  chart_type: string
  question_key: string | null
  metric: string | null
  label: string | null
  options: Json | null
  result: Json
}

export type SharedReportPayload = {
  report: { name: string }
  survey: { title: string }
  workspace: { name: string; logo_path: string | null }
  widgets: SharedReportWidget[]
}

export const sharedReportInput = z.object({
  token: z.string().min(1).max(100),
  password: z.string().max(200).nullable().default(null),
})

export function sharedReportPayload(client: AdminClient, input: z.input<typeof sharedReportInput>) {
  return call(
    sharedReportInput,
    input,
    // The generated type marks p_password as string; SQL accepts null for no password.
    (v) => client.rpc('shared_report_payload', { p_token: v.token, p_password: v.password as string }),
    (d): SharedReportPayload | null => (d ? (d as unknown as SharedReportPayload) : null),
  )
}
