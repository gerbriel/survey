'use client'

import type { ConsentQuestion } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { RichTextView } from '../richtext'
import { choiceRow, nativeCheck } from './shared'

/**
 * Consent checkbox. Checked stores 1; unchecked removes the answer.
 * `gates_tracking` is surfaced through ctx.onTrackingConsent and a data
 * attribute so Phase 2C can load pixels in the in_form consent mode (00 R7).
 */
export function ConsentInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<ConsentQuestion>) {
  const checked = value === 1 || value === true || value === '1'
  const text = question.settings.custom_text
  const gates = question.settings.gates_tracking === true
  return (
    <label className={cx(choiceRow, 'items-start')}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        className={cx(nativeCheck, 'mt-0.5')}
        data-gates-tracking={gates ? 'true' : undefined}
        aria-labelledby={`${labelId} ${inputId}-text`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => {
          onChange(e.target.checked ? 1 : undefined)
          if (gates) ctx.onTrackingConsent?.(e.target.checked, question.question_key)
        }}
      />
      <span id={`${inputId}-text`}>{text ? <RichTextView text={text} definition={ctx.definition} state={ctx.state} /> : ctx.strings.consentDefault}</span>
    </label>
  )
}
