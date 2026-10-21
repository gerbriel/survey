'use client'

import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'
import type { Page, ValidationError } from '@/lib/survey'
import type { InputContext } from './types'
import { cx } from '@/components/ui/cx'
import { QuestionBlock } from './QuestionFrame'
import { RichTextView } from './richtext'

/**
 * One screen: page heading (focus target on step change), description, the
 * visible questions in seeded order, and the navigation slot.
 * Decision: question_view uses IntersectionObserver at 50 percent when the
 * browser has it (doc 04 section 3.2) and fires on show otherwise.
 */
export function PageView({
  page,
  headingId,
  heading,
  questionIds,
  answers,
  errors,
  numbers,
  ctx,
  onChange,
  onQuestionView,
  showDescription,
  children,
}: {
  page: Page
  headingId: string
  heading: string
  questionIds: string[]
  answers: Record<string, unknown>
  errors: Record<string, ValidationError[]>
  numbers: Record<string, number>
  ctx: InputContext
  onChange: (questionKey: string, value: unknown) => void
  onQuestionView?: (questionKey: string, position: number) => void
  showDescription: boolean
  children?: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const report = useEffectEvent((key: string) => {
    onQuestionView?.(key, questionIds.findIndex((id) => ctx.definition.questions[id]?.question_key === key) + 1)
  })
  const screenKey = questionIds.join(',')

  useEffect(() => {
    const root = container.current
    if (!root) return
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-question-key]'))
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of els) report(el.dataset.questionKey ?? '')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          report((e.target as HTMLElement).dataset.questionKey ?? '')
          io.unobserve(e.target)
        }
      },
      { threshold: 0.5 },
    )
    for (const el of els) io.observe(el)
    return () => io.disconnect()
  }, [screenKey, page.id])

  return (
    <div ref={container} className="flex flex-col gap-6" data-page-id={page.id}>
      <div className="flex flex-col gap-2">
        {/* Decision: an untitled page keeps a focusable "Step n of m" heading, visually hidden so it does not repeat the progress text. */}
        <h2
          id={headingId}
          tabIndex={-1}
          className={cx('text-xl font-semibold outline-none [font-family:var(--sv-font-heading)]', !page.title && 'sr-only')}
        >
          {heading}
        </h2>
        {showDescription && page.description ? (
          <div className="text-muted">
            <RichTextView text={page.description} definition={ctx.definition} state={ctx.state} />
          </div>
        ) : null}
      </div>
      {questionIds.map((id) => {
        const q = ctx.definition.questions[id]
        if (!q) return null
        return (
          <QuestionBlock
            key={id}
            question={q}
            value={answers[q.question_key]}
            onChange={(v) => onChange(q.question_key, v)}
            errors={errors[q.question_key] ?? []}
            number={numbers[id]}
            ctx={ctx}
          />
        )
      })}
      {children}
    </div>
  )
}
