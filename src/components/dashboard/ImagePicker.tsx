'use client'

import { useEffect, useId, useState } from 'react'
import { coverSrc, type CoverImage, type CoverSource } from '@/lib/survey'
import { STARTER_HEADERS, starterHeaderPath } from '@/lib/images/starters'
import { listWorkspaceImages, type WorkspaceImage } from '@/lib/db/images'
import { publicAssetUrl } from '@/lib/builder/share'
import { createBrowserClient } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { cx, focusRing } from '@/components/ui/cx'

export type UploadedImage = { ok: true; image: WorkspaceImage } | { ok: false; message: string }

/**
 * Posts one file to the library upload route (settings/images/upload) and
 * returns the registered image or a message safe to show. Shared by the
 * library page and the picker.
 */
export async function uploadLibraryImage(uploadUrl: string, file: File, kind: 'header' | 'logo' | 'other' = 'header'): Promise<UploadedImage> {
  try {
    const body = new FormData()
    body.set('file', file)
    body.set('kind', kind)
    const res = await fetch(uploadUrl, { method: 'POST', body })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; image?: WorkspaceImage } | null
    if (res.ok && json?.ok && json.image) return { ok: true, image: json.image }
    return { ok: false, message: json?.message ?? 'The upload failed. Try again.' }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' }
  }
}

const assetUrl = (path: string) => publicAssetUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, path)

function Thumb({ src, label, selected, onSelect, disabled }: { src: string | null; label: string; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex flex-col gap-1 rounded-md border p-1 text-left text-xs disabled:opacity-60',
        focusRing,
        selected ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-fg',
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- app starter or Storage URL, no image optimizer configured
        <img src={src} alt="" className="h-12 w-full rounded-sm object-cover" />
      ) : (
        <span className="flex h-12 items-center justify-center text-muted">No preview</span>
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Header image picker for the theme editor (doc 03 section 8.1): tabs for
 * the starter set, the workspace library and a quick upload (which adds the
 * file to the library and selects it), a preview and a clear button.
 * The library list loads with the member's browser client under RLS the
 * first time its tab opens.
 */
export function ImagePicker({
  value,
  onChange,
  workspaceId,
  uploadUrl,
  disabled,
}: {
  value: CoverImage | undefined
  onChange: (source: CoverSource | null) => void
  workspaceId: string
  /** Library upload route; null hides the upload tab. */
  uploadUrl: string | null
  disabled?: boolean
}) {
  const inputId = useId()
  const [tab, setTab] = useState(value?.source.kind === 'workspace' ? 'workspace' : 'starter')
  const [images, setImages] = useState<WorkspaceImage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'workspace' || images !== null) return
    let live = true
    void listWorkspaceImages(createBrowserClient(), { workspaceId }).then((r) => {
      if (!live) return
      if (r.ok) setImages(r.data)
      else setLoadError(r.error.message)
    })
    return () => {
      live = false
    }
  }, [tab, images, workspaceId])

  const preview = coverSrc(value, assetUrl)
  const src = value?.source
  const isStarter = (id: string) => src?.kind === 'starter' && src.id === id
  const isImage = (id: string) => src?.kind === 'workspace' && src.image_id === id

  const starter = (
    <div className="grid grid-cols-2 gap-2">
      {STARTER_HEADERS.map((s) => (
        <Thumb key={s.id} src={starterHeaderPath(s.id)} label={s.label} selected={isStarter(s.id)} disabled={disabled} onSelect={() => onChange({ kind: 'starter', id: s.id })} />
      ))}
    </div>
  )

  const library =
    loadError !== null ? (
      <p className="text-xs text-danger">{loadError}</p>
    ) : images === null ? (
      <p className="text-xs text-muted">Loading images...</p>
    ) : images.length === 0 ? (
      <p className="text-xs text-muted">No images in the workspace library yet. Upload one, or add them in workspace settings under Images.</p>
    ) : (
      <div className="grid grid-cols-2 gap-2">
        {images.map((img) => (
          <Thumb
            key={img.id}
            src={assetUrl(img.path)}
            label={img.label || 'Untitled image'}
            selected={isImage(img.id)}
            disabled={disabled}
            onSelect={() => onChange({ kind: 'workspace', image_id: img.id, path: img.path })}
          />
        ))}
      </div>
    )

  const upload = (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        Upload a header image
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled || busy || !uploadUrl}
        aria-describedby={`${inputId}-hint`}
        className={cx('text-sm', focusRing)}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file || !uploadUrl) return
          setUploadError(null)
          setBusy(true)
          const r = await uploadLibraryImage(uploadUrl, file, 'header')
          setBusy(false)
          if (!r.ok) return setUploadError(r.message)
          setImages((list) => (list ? [r.image, ...list] : list))
          onChange({ kind: 'workspace', image_id: r.image.id, path: r.image.path })
        }}
      />
      <p id={`${inputId}-hint`} className="text-xs text-muted">
        PNG, JPEG or WebP, up to 2 MB. 1600 by 400 pixels works well. The image is added to the workspace library.
      </p>
      {busy ? (
        <p role="status" className="text-xs text-muted">
          Uploading...
        </p>
      ) : null}
      {uploadError ? <p className="text-xs text-danger">{uploadError}</p> : null}
    </div>
  )

  const items = [
    { id: 'starter', label: 'Starter', content: starter },
    { id: 'workspace', label: 'Workspace library', content: library },
    ...(uploadUrl && !disabled ? [{ id: 'upload', label: 'Upload now', content: upload }] : []),
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface-muted">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- app starter or Storage URL, no image optimizer configured
          <img src={preview} alt="Current header image" className="h-20 w-full object-cover" />
        ) : (
          <p className="flex h-20 items-center justify-center text-xs text-muted">No header image</p>
        )}
      </div>
      <Tabs label="Header image source" value={tab} onChange={setTab} items={items} />
      {value && !disabled ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange(null)}>
          Remove header image
        </Button>
      ) : null}
    </div>
  )
}
