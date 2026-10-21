'use client'

import { useId, type ComponentType, type ReactNode } from 'react'
import type { Question, ValidationError } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import type { InputContext, InputProps } from './types'
import { registry } from './registry'
import { RichTextView } from './richtext'
import { addressPartLabel } from './inputs/AddressInput'
import { joinIds } from './inputs/shared'

export interface QuestionIds {
  inputId: string
  labelId: string
  helpId: string
  errorId: string
}

function errorText(q: Question, e: ValidationError, ctx: InputContext): string {
  if (e.row_id && q.type === 'matrix') {
    const row = q.settings.rows.find((r) => r.id === e.row_id)
    if (row) return `${row.label}: ${e.message}`
  }
  if (e.part && q.type === 'address') {
    return `${addressPartLabel(e.part as Parameters<typeof addressPartLabel>[0], ctx.strings)}: ${e.message}`
  }
  return e.message
}

/**
 * Wraps one question: fieldset and legend, help text, and an always-present
 * aria-live error region (doc 02 section 11). Display blocks use a section.
 */
export function QuestionFrame({
  question,
  ids,
  errors,
  number,
  ctx,
  children,
}: {
  question: Question
  ids: QuestionIds
  errors: ValidationError[]
  number?: number
  ctx: InputContext
  children: ReactNode
}) {
  const kind = registry[question.type].frame
  if (kind === 'none') return null
  if (question.type === 'calculated' && !question.settings.visible) return null
  const label = <RichTextView text={question.label} definition={ctx.definition} state={ctx.state} />
  const help = question.help ? (
    <p id={ids.helpId} className="text-sm text-muted">
      <RichTextView text={question.help} definition={ctx.definition} state={ctx.state} />
    </p>
  ) : null
  const invalid = errors.length > 0
  const errorRegion = (
    <div id={ids.errorId} aria-live="polite" className="flex flex-col gap-1 empty:hidden">
      {errors.map((e, i) => (
        <p key={`${e.code}-${e.row_id ?? ''}-${e.part ?? ''}-${i}`} className="text-sm font-medium text-[var(--sv-error)]">
          <span aria-hidden="true">! </span>
          {errorText(question, e, ctx)}
        </p>
      ))}
    </div>
  )
  if (kind === 'block') {
    return (
      <section data-question-key={question.question_key} aria-labelledby={ids.labelId} className="flex flex-col gap-2">
        <p id={ids.labelId} className="font-semibold [font-family:var(--sv-font-heading)]">
          {label}
        </p>
        {help}
        {children}
      </section>
    )
  }
  return (
    <fieldset
      data-question-key={question.question_key}
      data-invalid={invalid || undefined}
      className={cx('flex min-w-0 flex-col gap-3', invalid && 'border-l-4 border-[var(--sv-error)] pl-3')}
    >
      <legend id={ids.labelId} className="mb-1 text-lg font-semibold [font-family:var(--sv-font-heading)]">
        {number !== undefined ? <span className="mr-1">{number}.</span> : null}
        {label}
        {question.required ? (
          <>
            <span aria-hidden="true" className="text-[var(--sv-error)]">
              {' '}
              *
            </span>
            <span className="sr-only"> ({ctx.strings.required})</span>
          </>
        ) : null}
      </legend>
      {help}
      {children}
      {errorRegion}
    </fieldset>
  )
}

/** QuestionFrame plus the registry Input for the question's type. */
export function QuestionBlock({
  question,
  value,
  onChange,
  errors,
  number,
  ctx,
}: {
  question: Question
  value: unknown
  onChange: (value: unknown) => void
  errors: ValidationError[]
  number?: number
  ctx: InputContext
}) {
  const base = useId()
  const ids: QuestionIds = {
    inputId: `${base}-in`,
    labelId: `${base}-label`,
    helpId: `${base}-help`,
    errorId: `${base}-err`,
  }
  const Input = registry[question.type].Input as ComponentType<InputProps<Question>>
  const invalid = errors.length > 0
  return (
    <QuestionFrame question={question} ids={ids} errors={errors} number={number} ctx={ctx}>
      <Input
        question={question}
        value={value}
        onChange={onChange}
        errors={errors}
        inputId={ids.inputId}
        labelId={ids.labelId}
        describedBy={joinIds(question.help && ids.helpId, invalid && ids.errorId)}
        invalid={invalid}
        ctx={ctx}
      />
    </QuestionFrame>
  )
}
