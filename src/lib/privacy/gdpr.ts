import 'server-only'
import { exportRespondentData } from '@/lib/db/privacy'
import type { DbResult } from '@/lib/db/errors'
import { ok } from '@/lib/db/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserClient } from '@/lib/supabase/types'

/**
 * GDPR export for one respondent (doc 04 section 7.3), editor and above.
 * export_respondent_data builds the JSON and logs `gdpr_export` as the
 * member; files come back as storage paths, which are replaced here by 7 day
 * signed URLs (service role, the response-files bucket is private).
 */
export const GDPR_URL_TTL = 7 * 24 * 3600

type FileEntry = { question_key?: unknown; name?: unknown; path?: unknown }

export async function gdprExport(supabase: UserClient, contactId: string): Promise<DbResult<Record<string, unknown>>> {
  const r = await exportRespondentData(supabase, { contactId })
  if (!r.ok) return r
  const doc = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>
  const files = Array.isArray(doc.files) ? (doc.files as FileEntry[]) : []
  if (files.length === 0) return ok({ ...doc, files: [] })
  const admin = createAdminClient()
  const signed = await Promise.all(
    files.map(async (f) => {
      const path = typeof f.path === 'string' ? f.path : null
      let url: string | null = null
      if (path) {
        const s = await admin.storage.from('response-files').createSignedUrl(path, GDPR_URL_TTL)
        url = s.error ? null : s.data.signedUrl
      }
      return { question_key: f.question_key ?? null, name: f.name ?? null, url }
    }),
  )
  return ok({ ...doc, files: signed })
}
