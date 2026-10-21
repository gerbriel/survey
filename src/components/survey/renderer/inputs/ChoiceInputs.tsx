'use client'

import { useState } from 'react'
import {
  orderOptions,
  type ChoiceOption,
  type MultipleChoiceQuestion,
  type SingleChoiceQuestion,
  type YesNoQuestion,
} from '@/lib/survey'
import { Input } from '@/components/ui/Input'
import { cx } from '@/components/ui/cx'
import type { InputContext, InputProps } from '../types'
import { RichTextView } from '../richtext'
import { asString, choiceRow, nativeCheck, textControl } from './shared'

function OptionLabel({ option, ctx }: { option: ChoiceOption; ctx: InputContext }) {
  const src = option.image_path ? ctx.resolveAssetUrl?.(option.image_path) : null
  return (
    <span className="flex flex-col gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Storage URL from the caller, sizes unknown at build time.
        <img src={src} alt="" className="max-h-32 w-auto rounded-[var(--sv-radius)] object-contain" />
      ) : null}
      <span>
        <RichTextView text={option.label} definition={ctx.definition} state={ctx.state} />
      </span>
    </span>
  )
}

function singleParts(value: unknown): { id: string; other: string } {
  if (typeof value === 'string') return { id: value, other: '' }
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    const o = value as { id: string; other?: unknown }
    return { id: o.id, other: asString(o.other) }
  }
  return { id: '', other: '' }
}

export function SingleChoiceInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<SingleChoiceQuestion>) {
  const options = orderOptions(question, ctx.seed)
  const { id, other } = singleParts(value)
  const selected = options.find((o) => o.id === id)
  const columns = question.settings.layout === 'columns'
  const pick = (o: ChoiceOption) => onChange(o.is_other ? { id: o.id, other } : o.id)
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        className={cx('grid gap-2', columns ? 'sm:grid-cols-2' : 'grid-cols-1')}
      >
        {options.map((o, i) => (
          <label key={o.id} className={choiceRow}>
            <input
              id={i === 0 ? inputId : undefined}
              type="radio"
              name={inputId}
              value={o.id}
              checked={o.id === id}
              className={nativeCheck}
              onChange={() => pick(o)}
            />
            <OptionLabel option={o} ctx={ctx} />
          </label>
        ))}
      </div>
      {selected?.is_other ? (
        <Input
          id={`${inputId}-other`}
          label={ctx.strings.otherLabel}
          className="h-11 text-base rounded-[var(--sv-radius)]"
          value={other}
          onChange={(e) => onChange({ id: selected.id, other: e.target.value })}
        />
      ) : null}
    </div>
  )
}

function multiParts(value: unknown): { ids: string[]; other: string } {
  if (Array.isArray(value)) return { ids: value.filter((x): x is string => typeof x === 'string'), other: '' }
  if (value && typeof value === 'object' && Array.isArray((value as { ids?: unknown }).ids)) {
    const o = value as { ids: unknown[]; other?: unknown }
    return { ids: o.ids.filter((x): x is string => typeof x === 'string'), other: asString(o.other) }
  }
  return { ids: [], other: '' }
}

export function MultipleChoiceInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<MultipleChoiceQuestion>) {
  const options = orderOptions(question, ctx.seed)
  const { ids, other } = multiParts(value)
  const otherOpt = options.find((o) => o.is_other && ids.includes(o.id))
  const emit = (next: string[], otherText: string) => {
    if (next.length === 0) return onChange(undefined)
    const hasOther = next.some((x) => options.find((o) => o.id === x)?.is_other)
    onChange(hasOther ? { ids: next, other: otherText } : next)
  }
  const toggle = (o: ChoiceOption, checked: boolean) => {
    if (!checked) return emit(ids.filter((x) => x !== o.id), other)
    // Exclusive options ("None of the above") clear every other selection, and the reverse.
    if (o.is_exclusive) return emit([o.id], other)
    const keep = ids.filter((x) => !options.find((p) => p.id === x)?.is_exclusive)
    // Decision: keep the respondent's click order, so piping lists choices as picked.
    emit([...keep, o.id], other)
  }
  const max = question.validation?.max_selections
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className="grid grid-cols-1 gap-2"
      >
        {options.map((o, i) => (
          <label key={o.id} className={choiceRow}>
            <input
              id={i === 0 ? inputId : undefined}
              type="checkbox"
              value={o.id}
              aria-invalid={invalid || undefined}
              checked={ids.includes(o.id)}
              className={nativeCheck}
              onChange={(e) => toggle(o, e.target.checked)}
            />
            <OptionLabel option={o} ctx={ctx} />
          </label>
        ))}
      </div>
      {max !== undefined ? <p className="sr-only">Select up to {max}.</p> : null}
      {otherOpt ? (
        <Input
          id={`${inputId}-other`}
          label={ctx.strings.otherLabel}
          className="h-11 text-base rounded-[var(--sv-radius)]"
          value={other}
          onChange={(e) => emit(ids, e.target.value)}
        />
      ) : null}
    </div>
  )
}

/** Decision: a filter box appears above the native select when searchable and the list is longer than 8. */
const FILTER_THRESHOLD = 8

export function DropdownInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<SingleChoiceQuestion>) {
  const [filter, setFilter] = useState('')
  const options = orderOptions(question, ctx.seed)
  const { id, other } = singleParts(value)
  const showFilter = question.settings.searchable === true && options.length > FILTER_THRESHOLD
  const needle = filter.trim().toLowerCase()
  const shown = needle ? options.filter((o) => o.id === id || o.label.toLowerCase().includes(needle)) : options
  const selected = options.find((o) => o.id === id)
  return (
    <div className="flex flex-col gap-3">
      {showFilter ? (
        <Input
          id={`${inputId}-filter`}
          label={ctx.strings.filterOptions}
          type="search"
          className="h-11 text-base rounded-[var(--sv-radius)]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : null}
      <select
        id={inputId}
        className={textControl}
        value={id}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={question.required || undefined}
        onChange={(e) => {
          const o = options.find((x) => x.id === e.target.value)
          onChange(!o ? undefined : o.is_other ? { id: o.id, other } : o.id)
        }}
      >
        <option value="">{shown.length === 0 ? ctx.strings.noMatches : ctx.strings.selectPlaceholder}</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {selected?.is_other ? (
        <Input
          id={`${inputId}-other`}
          label={ctx.strings.otherLabel}
          className="h-11 text-base rounded-[var(--sv-radius)]"
          value={other}
          onChange={(e) => onChange({ id: selected.id, other: e.target.value })}
        />
      ) : null}
    </div>
  )
}

function asBool01(v: unknown): 0 | 1 | null {
  if (v === 1 || v === true || v === '1' || v === 'true') return 1
  if (v === 0 || v === false || v === '0' || v === 'false') return 0
  return null
}

export function YesNoInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<YesNoQuestion>) {
  const v = asBool01(value)
  const choices: Array<{ v: 0 | 1; label: string }> = [
    { v: 1, label: question.settings.yes_label || ctx.strings.yes },
    { v: 0, label: question.settings.no_label || ctx.strings.no },
  ]
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={question.required || undefined}
      className="grid grid-cols-2 gap-2 sm:max-w-sm"
    >
      {choices.map((c, i) => (
        <label key={c.v} className={cx(choiceRow, 'justify-center')}>
          <input
            id={i === 0 ? inputId : undefined}
            type="radio"
            name={inputId}
            checked={v === c.v}
            className={nativeCheck}
            onChange={() => onChange(c.v)}
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  )
}
