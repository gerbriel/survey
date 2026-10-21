'use client'

import { formatCalc, type CalculatedQuestion, type ImageQuestion, type StatementQuestion } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { fmt } from '../strings'
import { RichTextView, safeHref } from '../richtext'

export function StatementBlock({ question, inputId, ctx }: InputProps<StatementQuestion>) {
  return (
    <div id={inputId} className="leading-relaxed">
      <RichTextView text={question.settings.body} definition={ctx.definition} state={ctx.state} />
    </div>
  )
}

const WIDTHS = { small: 'max-w-xs', medium: 'max-w-md', full: 'w-full' } as const

export function ImageBlock({ question, inputId, ctx }: InputProps<ImageQuestion>) {
  const { path, alt, width, href } = question.settings
  const src = ctx.resolveAssetUrl?.(path) ?? null
  const link = href ? safeHref(href) : null
  // Decision: without a resolvable URL (dev gallery, missing asset) the alt text shows in a placeholder box.
  const img = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Storage URL from the caller, sizes unknown at build time.
    <img id={inputId} src={src} alt={alt} className={cx('h-auto rounded-[var(--sv-radius)]', WIDTHS[width] ?? WIDTHS.full)} />
  ) : (
    <div
      id={inputId}
      role="img"
      aria-label={alt}
      className={cx('flex min-h-24 items-center justify-center rounded-[var(--sv-radius)] border border-dashed border-border p-4 text-sm text-muted', WIDTHS[width] ?? WIDTHS.full)}
    >
      {fmt(ctx.strings.imageMissing, { alt })}
    </div>
  )
  if (!link) return img
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block">
      {img}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** Hidden fields never render; their value comes from the URL (doc 03 section 3 step 2). */
export function HiddenField(): null {
  return null
}

/** Read-only computed value, shown only when the definition says `visible: true`. */
export function CalculatedDisplay({ question, inputId, labelId, ctx }: InputProps<CalculatedQuestion>) {
  if (!question.settings.visible) return null
  const v = ctx.state.calcs[question.id]
  return (
    <output id={inputId} aria-labelledby={labelId} className="text-2xl font-semibold">
      {v === undefined ? ctx.strings.calculatedEmpty : formatCalc(question, v)}
    </output>
  )
}
