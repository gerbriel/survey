import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { affected, call, id } from './rpc'

/**
 * Workspace pixels (doc 02 section 7, migration 0010). RLS: members read,
 * admin writes; the raw script kill switch is a trigger. Public pages never
 * read this table: resolve_public_survey returns the enabled pixels.
 */
export type WorkspacePixel = Tables<'workspace_pixels'>
export type PixelSummary = Pick<WorkspacePixel, 'id' | 'type' | 'label' | 'enabled'>

/** Same values as the pixel_type enum. */
const pixelType = z.enum(['ga4', 'meta', 'gtm', 'custom_script'])

export const listPixelsInput = z.object({ workspaceId: id })

/** Every column, for the settings page. */
export function listPixels(client: UserClient, input: z.input<typeof listPixelsInput>) {
  return call(
    listPixelsInput,
    input,
    (v) =>
      client.from('workspace_pixels').select('*').eq('workspace_id', v.workspaceId).order('created_at', { ascending: true }),
    (rows): WorkspacePixel[] => rows ?? [],
  )
}

/** Id, type, label and enabled only, for the builder's per-survey exclusions (no script bodies). */
export function listPixelSummaries(client: UserClient, input: z.input<typeof listPixelsInput>) {
  return call(
    listPixelsInput,
    input,
    (v) =>
      client.from('workspace_pixels').select('id, type, label, enabled').eq('workspace_id', v.workspaceId).order('created_at'),
    (rows): PixelSummary[] => rows ?? [],
  )
}

const pixelFields = {
  type: pixelType,
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
