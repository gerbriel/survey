'use client'

import { useState } from 'react'
import type { FileRef, FileUploadQuestion } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { cx, focusRing } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { Hint, joinIds } from './shared'

export function asFileRefs(v: unknown): FileRef[] {
  if (!Array.isArray(v)) return []
  return v.filter((f): f is FileRef => !!f && typeof f === 'object' && typeof (f as FileRef).path === 'string' && typeof (f as FileRef).name === 'string')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Presentational: hands File objects to `uploads.request` and shows the
 * caller's pending list and the attached refs held in the answer. Transport,
 * limits enforcement and Turnstile live in Phase 2C (doc 02 section 6).
 */
export function FileUploadInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<FileUploadQuestion>) {
  const files = asFileRefs(value)
  const uploads = ctx.uploads
  const pending = uploads?.pending?.[question.question_key] ?? []
  const [busy, setBusy] = useState(false)
  const val = question.validation
  const maxFiles = val?.max_files
  const hintId = `${inputId}-limits`
  const limits = [
    val?.allowed_extensions?.length ? fmt(ctx.strings.fileAllowed, { types: val.allowed_extensions.join(', ') }) : null,
    val?.max_file_mb !== undefined ? fmt(ctx.strings.fileMaxSize, { mb: val.max_file_mb }) : null,
    maxFiles !== undefined ? fmt(ctx.strings.fileMaxCount, { n: maxFiles }) : null,
  ].filter(Boolean)
  const full = maxFiles !== undefined && files.length >= maxFiles
  const disabled = !uploads || busy || full

  async function pick(list: FileList | null) {
    if (!uploads || !list || list.length === 0) return
    setBusy(true)
    try {
      const room = maxFiles !== undefined ? Math.max(0, maxFiles - files.length) : list.length
      const picked = Array.from(list).slice(0, room)
      const refs = await Promise.all(picked.map((f) => uploads.request(question.question_key, f).catch(() => null)))
      const added = refs.filter((r): r is FileRef => r !== null)
      if (added.length > 0) onChange([...files, ...added])
    } finally {
      setBusy(false)
    }
  }

  async function remove(ref: FileRef) {
    const next = files.filter((f) => f.path !== ref.path)
    onChange(next.length > 0 ? next : undefined)
    await uploads?.remove(question.question_key, ref)
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        className={cx(
          'flex min-h-11 w-fit cursor-pointer items-center rounded-[var(--sv-radius)] border border-dashed border-border px-4 py-2',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span>{ctx.strings.fileChoose}</span>
        <input
          id={inputId}
          type="file"
          className={cx('sr-only', focusRing)}
          multiple={maxFiles !== 1}
          accept={val?.allowed_extensions?.map((e) => `.${e}`).join(',')}
          disabled={disabled}
          aria-labelledby={`${labelId} ${inputId}-choose`}
          aria-describedby={joinIds(describedBy, limits.length > 0 && hintId)}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const list = e.target.files
            void pick(list).then(() => {
              e.target.value = ''
            })
          }}
        />
        <span id={`${inputId}-choose`} className="sr-only">
          {ctx.strings.fileChoose}
        </span>
      </label>
      {limits.length > 0 ? <Hint id={hintId}>{limits.join('. ')}</Hint> : null}
      {!uploads ? <Hint>{ctx.strings.fileUnavailable}</Hint> : null}
      {files.length > 0 || pending.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-3 rounded-[var(--sv-radius)] border border-border px-3 py-1">
              <span className="truncate">
                {f.name} <span className="text-sm text-muted">({formatBytes(f.size)})</span>
              </span>
              <Button variant="ghost" size="sm" className="min-h-11" aria-label={fmt(ctx.strings.fileRemove, { name: f.name })} onClick={() => void remove(f)}>
                <span aria-hidden="true">&times;</span>
              </Button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 rounded-[var(--sv-radius)] border border-dashed border-border px-3 py-2">
              <span>{fmt(ctx.strings.fileUploading, { name: p.name })}</span>
              {p.progress !== undefined ? (
                <progress className="w-full accent-[var(--sv-primary)]" max={100} value={p.progress} aria-label={fmt(ctx.strings.fileUploading, { name: p.name })} />
              ) : null}
              {p.error ? <span className="text-sm text-danger">{p.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
