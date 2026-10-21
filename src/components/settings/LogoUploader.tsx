'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useId, useState } from 'react'
import { FormStatus, SubmitButton } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'

/**
 * Logo upload to public-assets (doc 05 section 5.1). The file goes to a
 * route handler, which sniffs the type and size and uploads with the
 * member's own client under Storage RLS.
 * Decision: a route handler rather than a server action, because server
 * action bodies are capped at 1 MB and the logo limit is 1 MB plus form
 * overhead. Upload needs JavaScript; everything else on the page does not.
 */
export function LogoUploader({
  uploadUrl,
  logoUrl,
  removeAction,
  canEdit,
}: {
  uploadUrl: string
  logoUrl: string | null
  removeAction: (prev: ActionState) => Promise<ActionState>
  canEdit: boolean
}) {
  const router = useRouter()
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ActionState>(IDLE)
  const [removeState, remove] = useActionState(removeAction, IDLE)

  async function upload(file: File) {
    setBusy(true)
    setStatus(IDLE)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(uploadUrl, { method: 'POST', body })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      setStatus(
        res.ok && json?.ok
          ? { status: 'success', message: json.message ?? 'Logo updated.' }
          : { status: 'error', message: json?.message ?? 'Upload failed. Try again.' },
      )
      if (res.ok) router.refresh()
    } catch {
      setStatus({ status: 'error', message: 'Could not reach the server. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage URL, no image optimizer configured
            <img src={logoUrl} alt="Current workspace logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-muted">No logo</span>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Upload a logo
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              aria-describedby={`${inputId}-hint`}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
              className="text-sm"
            />
            <p id={`${inputId}-hint`} className="text-xs text-muted">
              PNG, JPEG or WebP, up to 1 MB, 128 to 2048 pixels per side. Square works best inside QR codes.
            </p>
          </div>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="text-sm text-muted">
          Uploading...
        </p>
      ) : (
        <FormStatus state={status} />
      )}
      {canEdit && logoUrl ? (
        <form action={remove} className="flex items-center gap-2">
          <SubmitButton variant="secondary" size="sm">
            Remove logo
          </SubmitButton>
          <FormStatus state={removeState} />
        </form>
      ) : null}
    </div>
  )
}
