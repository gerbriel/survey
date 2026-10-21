'use client'

import { useId, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/browser'
import { cx, focusRing } from '@/components/ui/cx'

const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * Uploads an image to the public-assets bucket under
 * `{workspace_id}/surveys/{survey_id}/{name}-{time}.{ext}` and reports the
 * object path (without the bucket name). Storage RLS requires editor.
 * Decision: paths stored in the definition and on surveys.og_image_path are
 * object names inside public-assets; public URLs are built with
 * publicAssetUrl() from src/lib/builder/share.ts.
 */
export function ImageUpload({
  label,
  workspaceId,
  surveyId,
  name,
  onUploaded,
  disabled,
}: {
  label: string
  workspaceId: string
  surveyId: string
  name: string
  onUploaded: (path: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={TYPES.join(',')}
        disabled={disabled || busy}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cx('text-sm', focusRing)}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setError(null)
          if (!TYPES.includes(file.type)) return setError('Use a PNG, JPEG, WebP or GIF image.')
          if (file.size > MAX_BYTES) return setError('Images can be at most 5 MB.')
          const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
          const path = `${workspaceId}/surveys/${surveyId}/${name}-${Date.now()}.${ext}`
          setBusy(true)
          const { error: upErr } = await createBrowserClient().storage.from('public-assets').upload(path, file, { contentType: file.type, upsert: false })
          setBusy(false)
          if (upErr) return setError('The upload failed. Check your connection and try again.')
          onUploaded(path)
        }}
      />
      {busy ? <p className="text-xs text-muted">Uploading...</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
