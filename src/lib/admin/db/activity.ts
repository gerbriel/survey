import 'server-only'
import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from '@/lib/db/rpc'

/** Activity log viewer (doc 05 section 5.7). RLS: admin and owner read. */
export type ActivityRow = Tables<'activity_log'>

/** Entity names written by log_activity() and write_activity() (migration 0003 and later). */
export const ACTIVITY_ENTITIES = [
  'survey',
  'survey_version',
  'alias',
  'template',
  'contact',
  'contact_field',
  'member',
  'invite',
  'workspace',
  'pixel',
  'limits',
  'report',
  'share',
  'export',
  'import',
] as const

export const ACTIVITY_PAGE_SIZE = 50

export const listActivityInput = z.object({
  workspaceId: id,
  entity: z.string().trim().max(40).optional(),
  actor: id.optional(),
  action: z.string().trim().max(60).optional(),
  entityId: id.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
})

export type ActivityPage = { rows: ActivityRow[]; total: number; page: number; pageSize: number }

export function listActivity(client: UserClient, input: z.input<typeof listActivityInput>) {
  return call(
    listActivityInput,
    input,
    (v) => {
      let q = client
        .from('activity_log')
        .select('*', { count: 'exact' })
        .eq('workspace_id', v.workspaceId)
        .order('created_at', { ascending: false })
      if (v.entity) q = q.eq('entity', v.entity)
      if (v.actor) q = q.eq('actor', v.actor)
      if (v.action) q = q.eq('action', v.action)
      if (v.entityId) q = q.eq('entity_id', v.entityId)
      if (v.from) q = q.gte('created_at', `${v.from}T00:00:00Z`)
      if (v.to) q = q.lt('created_at', new Date(new Date(`${v.to}T00:00:00Z`).getTime() + 86_400_000).toISOString())
      const start = (v.page - 1) * ACTIVITY_PAGE_SIZE
      return q.range(start, start + ACTIVITY_PAGE_SIZE - 1).then((r) => ({ data: { rows: r.data, count: r.count }, error: r.error }))
    },
    (d, v): ActivityPage => ({ rows: d.rows ?? [], total: d.count ?? 0, page: v.page, pageSize: ACTIVITY_PAGE_SIZE }),
  )
}
