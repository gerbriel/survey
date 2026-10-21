import 'server-only'
import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id, jsonObject } from '@/lib/db/rpc'
import { affected } from './shared'

/** Workspace settings writes under RLS (workspaces_update: admin). See shared.ts for why this is here. */

export const updateGeneralInput = z.object({
  workspaceId: id,
  name: z.string().trim().min(1, 'Enter a name.').max(80, 'Use 80 characters or fewer.'),
  showPoweredBy: z.boolean(),
  defaultTheme: jsonObject,
})

export function updateWorkspaceGeneral(client: UserClient, input: z.input<typeof updateGeneralInput>) {
  return call(
    updateGeneralInput,
    input,
    (v) =>
      affected(
        client
          .from('workspaces')
          .update({
            name: v.name,
            show_powered_by: v.showPoweredBy,
            default_theme: v.defaultTheme as Tables<'workspaces'>['default_theme'],
          })
          .eq('id', v.workspaceId)
          .select('id'),
      ),
    () => undefined,
  )
}

export const PIXEL_CONSENT_MODES = ['banner', 'notice', 'in_form'] as const

export const updatePrivacyInput = z.object({
  workspaceId: id,
  storeIp: z.boolean(),
  retentionDays: z.number().int().min(30, 'Keep at least 30 days.').max(3650, 'Use 3650 days or fewer.').nullable(),
  defaultCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two letter country code, for example US.'),
  privacyNoticeUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((s) => /^https:\/\/[^\s]+$/i.test(s), 'Use an https:// address.')
    .nullable(),
  consentDefaultText: z.string().trim().max(2000, 'Use 2000 characters or fewer.').nullable(),
  pixelConsentMode: z.enum(PIXEL_CONSENT_MODES),
  /** Required when switching to notice; the trigger stamps who. */
  acknowledgeNotice: z.boolean(),
})

/** Decision: switching to `notice` requires the acknowledgment every time it is selected anew. */
export function updateWorkspacePrivacy(
  client: UserClient,
  input: z.input<typeof updatePrivacyInput>,
  current: { pixel_consent_mode: string; pixel_notice_ack_at: string | null },
) {
  return call(
    updatePrivacyInput,
    input,
    (v) => {
      const patch: Partial<Tables<'workspaces'>> = {
        store_ip: v.storeIp,
        retention_days: v.retentionDays,
        default_country: v.defaultCountry,
        privacy_notice_url: v.privacyNoticeUrl,
        consent_default_text: v.consentDefaultText,
        pixel_consent_mode: v.pixelConsentMode,
      }
      if (v.pixelConsentMode === 'notice' && (current.pixel_consent_mode !== 'notice' || !current.pixel_notice_ack_at)) {
        if (!v.acknowledgeNotice) {
          return Promise.resolve({ data: null, error: { message: 'invalid_state' } })
        }
        patch.pixel_notice_ack_at = new Date().toISOString()
      }
      return affected(client.from('workspaces').update(patch).eq('id', v.workspaceId).select('id'))
    },
    () => undefined,
  )
}

export const setLogoInput = z.object({ workspaceId: id, logoPath: z.string().max(300).nullable() })

export function setWorkspaceLogoPath(client: UserClient, input: z.input<typeof setLogoInput>) {
  return call(
    setLogoInput,
    input,
    (v) => affected(client.from('workspaces').update({ logo_path: v.logoPath }).eq('id', v.workspaceId).select('id')),
    () => undefined,
  )
}

export const LOGO_BUCKET = 'public-assets'

export const uploadLogoInput = z.object({
  workspaceId: id,
  path: z.string().regex(/^[0-9a-f-]{36}\/logo-[a-f0-9]{16}\.(png|jpg|webp)$/),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.instanceof(Uint8Array),
})

/** Storage write under storage.objects RLS: a top-level logo needs admin (migration 0008). */
export function uploadLogoObject(client: UserClient, input: z.input<typeof uploadLogoInput>) {
  return call(
    uploadLogoInput,
    input,
    (v) =>
      client.storage
        .from(LOGO_BUCKET)
        .upload(v.path, v.bytes, { contentType: v.contentType, upsert: true, cacheControl: '31536000' }),
    () => undefined,
  )
}

export const removeLogoInput = z.object({ path: z.string().min(1).max(300) })

export function removeLogoObject(client: UserClient, input: z.input<typeof removeLogoInput>) {
  return call(removeLogoInput, input, (v) => client.storage.from(LOGO_BUCKET).remove([v.path]), () => undefined)
}

/** Public URL of a public-assets path, for <img>. Pure string work on the client. */
export function logoPublicUrl(client: UserClient, path: string | null): string | null {
  if (!path) return null
  return client.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl
}

export const slugHistoryInput = z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) })

export type SlugHistoryRow = { workspace_id: string | null; released_at: string }

/** Old slug lookup for the 30 day redirect. RLS returns it only to members of the workspace. */
export function getSlugHistory(client: UserClient, input: z.input<typeof slugHistoryInput>) {
  return call(
    slugHistoryInput,
    input,
    (v) => client.from('workspace_slug_history').select('workspace_id, released_at').eq('slug', v.slug).maybeSingle(),
    (row): SlugHistoryRow | null => row ?? null,
  )
}
