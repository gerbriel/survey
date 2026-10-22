'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useId, useState } from 'react'
import { FormStatus, SubmitButton } from '@/components/dashboard/form'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { uploadLibraryImage } from '@/components/dashboard/ImagePicker'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { STARTER_HEADERS, starterHeaderPath } from '@/lib/images/starters'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type LibraryImage = { id: string; label: string; url: string | null; kind: string; width: number | null; height: number | null; bytes: number }

const KIND_LABEL: Record<string, string> = { header: 'Header', logo: 'Logo', other: 'Other' }

function sizeText(img: LibraryImage): string {
  const kb = Math.max(1, Math.round(img.bytes / 1024))
  const dims = img.width && img.height ? `${img.width} by ${img.height}, ` : ''
  return `${dims}${kb} KB`
}

function LabelForm({ image, action }: { image: LibraryImage; action: Action }) {
  const [state, run] = useActionState(action, IDLE)
  return (
    <form action={run} className="flex flex-col gap-1">
      <input type="hidden" name="imageId" value={image.id} />
      <Input name="label" label="Label" defaultValue={image.label} maxLength={120} error={state.fieldErrors?.label} />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant="secondary">
          Save label
        </SubmitButton>
        <FormStatus state={state} />
      </div>
    </form>
  )
}

/**
 * Workspace image library (doc 03 section 8.1): upload, label edit and
 * delete for editors, read only for viewers, starters shown read only.
 */
export function ImageLibrary({
  images,
  uploadUrl,
  canEdit,
  renameAction,
  deleteAction,
}: {
  images: LibraryImage[]
  uploadUrl: string
  canEdit: boolean
  renameAction: Action
  deleteAction: Action
}) {
  const router = useRouter()
  const inputId = useId()
  const [kind, setKind] = useState<'header' | 'logo' | 'other'>('header')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ActionState>(IDLE)

  async function upload(file: File) {
    setBusy(true)
    setStatus(IDLE)
    const r = await uploadLibraryImage(uploadUrl, file, kind)
    setBusy(false)
    setStatus(r.ok ? { status: 'success', message: 'Image added.' } : { status: 'error', message: r.message })
    if (r.ok) router.refresh()
  }

  return (
    <div className="flex flex-col gap-10">
      {canEdit ? (
        <section aria-labelledby="upload-heading" className="flex flex-col gap-3">
          <h2 id="upload-heading" className="text-lg font-semibold">
            Add an image
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <Select
              label="Use"
              options={[
                { value: 'header', label: 'Header' },
                { value: 'logo', label: 'Logo' },
                { value: 'other', label: 'Other' },
              ]}
              value={kind}
              onChange={(e) => setKind(e.target.value as 'header' | 'logo' | 'other')}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={inputId} className="text-sm font-medium">
                Image file
              </label>
              <input
                id={inputId}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                aria-describedby={`${inputId}-hint`}
                className="text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void upload(f)
                }}
              />
            </div>
          </div>
          <p id={`${inputId}-hint`} className="text-xs text-muted">
            PNG, JPEG or WebP, up to 2 MB. Headers look best at 1600 by 400 pixels.
          </p>
          {busy ? (
            <p role="status" className="text-sm text-muted">
              Uploading...
            </p>
          ) : (
            <FormStatus state={status} />
          )}
        </section>
      ) : null}

      <section aria-labelledby="library-heading" className="flex flex-col gap-3">
        <h2 id="library-heading" className="text-lg font-semibold">
          Workspace images
        </h2>
        {images.length === 0 ? (
          <p className="text-sm text-muted">No images yet.{canEdit ? ' Add one above, or upload from the theme editor in any survey.' : ''}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img) => (
              <li key={img.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage URL, no image optimizer configured
                  <img src={img.url} alt={img.label || 'Workspace image'} className="h-28 w-full rounded-md bg-surface-muted object-cover" />
                ) : null}
                <p className="text-xs text-muted">
                  {KIND_LABEL[img.kind] ?? img.kind}, {sizeText(img)}
                </p>
                {canEdit ? (
                  <>
                    <LabelForm image={img} action={renameAction} />
                    <InlineAction
                      action={deleteAction}
                      fields={{ imageId: img.id }}
                      label="Delete"
                      variant="danger"
                      confirmLabel="Delete image"
                      confirm="The image leaves the library. Surveys that already use it keep showing it."
                    />
                  </>
                ) : (
                  <p className="text-sm font-medium">{img.label || 'Untitled image'}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="starter-heading" className="flex flex-col gap-3">
        <h2 id="starter-heading" className="text-lg font-semibold">
          Starter headers
        </h2>
        <p className="text-sm text-muted">Included with every workspace. Pick one in a survey&apos;s theme editor. They cannot be changed or deleted.</p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STARTER_HEADERS.map((s) => (
            <li key={s.id} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- static app file */}
              <img src={starterHeaderPath(s.id) ?? ''} alt="" className="h-16 w-full rounded-md border border-border object-cover" />
              <span className="text-sm">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
