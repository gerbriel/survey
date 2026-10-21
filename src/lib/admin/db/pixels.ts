import 'server-only'
import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from '@/lib/db/rpc'
import { PIXEL_TYPES } from '../pixels'
import { affected } from './shared'

/** Workspace pixels (doc 02 section 7). RLS: members read, admin writes; kill switch is a trigger. */
export type WorkspacePixel = Tables<'workspace_pixels'>

export const listPixelsInput = z.object({ workspaceId: id })

export function listPixels(client: UserClient, input: z.input<typeof listPixelsInput>) {
  return call(
    listPixelsInput,
    input,
    (v) =>
      client.from('workspace_pixels').select('*').eq('workspace_id', v.workspaceId).order('created_at', { ascending: true }),
    (rows): WorkspacePixel[] => rows ?? [],
  )
}

const pixelFields = {
  type: z.enum(PIXEL_TYPES),
  value: z.string().trim().min(1).max(10_000),
  label: z.string().trim().min(1, 'Add a label.').max(80, 'Use 80 characters or fewer.'),
  enabled: z.boolean(),
  /** Parsed custom script, or null for ID pixels. Computed by the caller with parseCustomScript. */
  parsed: z.unknown().nullable(),
}

export const createPixelInput = z.object({ workspaceId: id, ...pixelFields })

export function createPixel(client: UserClient, input: z.input<typeof createPixelInput>) {
  return call(
    createPixelInput,
    input,
    (v) =>
      client
        .from('workspace_pixels')
        .insert({
          workspace_id: v.workspaceId,
          type: v.type,
          value: v.value,
          label: v.label,
          enabled: v.enabled,
          parsed: (v.parsed ?? null) as Json,
        })
        .select('id')
        .single(),
    (row): string => (row as { id: string }).id,
  )
}

export const updatePixelInput = z.object({ workspaceId: id, pixelId: id, ...pixelFields })

export function updatePixel(client: UserClient, input: z.input<typeof updatePixelInput>) {
  return call(
    updatePixelInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_pixels')
          .update({ type: v.type, value: v.value, label: v.label, enabled: v.enabled, parsed: (v.parsed ?? null) as Json })
          .eq('id', v.pixelId)
          .eq('workspace_id', v.workspaceId)
          .select('id'),
      ),
    () => undefined,
  )
}

export const deletePixelInput = z.object({ workspaceId: id, pixelId: id })

export function deletePixel(client: UserClient, input: z.input<typeof deletePixelInput>) {
  return call(
    deletePixelInput,
    input,
    (v) =>
      affected(
        client.from('workspace_pixels').delete().eq('id', v.pixelId).eq('workspace_id', v.workspaceId).select('id'),
      ),
    () => undefined,
  )
}
