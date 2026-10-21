'use client'

import type { AddressPart, ChoiceOption, MatrixColumn, Question, SurveyDefinition } from '@/lib/survey'
import { ADDRESS_PARTS } from '@/lib/survey'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { parseFormula } from '@/lib/builder/formula'
import { Check, NumberField, TextArea } from './fields'
import { OptionsEditor } from './OptionsEditor'
import { PipingPicker } from './PipingPicker'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ADDRESS_LABELS: Record<AddressPart, string> = {
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  region: 'State or region',
  postal: 'Postal code',
  country: 'Country',
}

function numOrUndef(v: number | undefined) {
  return v === undefined || Number.isNaN(v) ? undefined : v
}

/** Remove keys whose value is undefined (definitions are pure JSON). */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

/**
 * Type-specific settings (doc 03 section 1 "Features to support"). Scores
 * and correct answers are server only: splitDefinition strips them at publish.
 */
export function TypeSettings({
  question: q,
  definition,
  pageIndex,
  onChange,
  disabled,
}: {
  question: Question
  definition: SurveyDefinition
  pageIndex: number | null
  onChange: (q: Question, key?: string) => void
  disabled?: boolean
}) {
  const set = (patch: Record<string, unknown>, key?: string) => onChange({ ...q, settings: clean({ ...q.settings, ...patch }) } as Question, key)
  const k = (name: string) => `${q.id}:settings:${name}`

  switch (q.type) {
    case 'short_text':
      return (
        <>
          <Input label="Placeholder" value={q.settings.placeholder ?? ''} disabled={disabled} onChange={(e) => set({ placeholder: e.target.value || undefined }, k('placeholder'))} />
          <Input
            label="Input mask"
            hint="9 is a digit, a is a letter, * is either. Other characters must match exactly."
            value={q.settings.mask ?? ''}
            disabled={disabled}
            onChange={(e) => set({ mask: e.target.value || undefined }, k('mask'))}
          />
        </>
      )
    case 'long_text':
      return (
        <>
          <Input label="Placeholder" value={q.settings.placeholder ?? ''} disabled={disabled} onChange={(e) => set({ placeholder: e.target.value || undefined }, k('placeholder'))} />
          <NumberField label="Rows" min={2} max={20} value={q.settings.rows} disabled={disabled} onChange={(v) => set({ rows: numOrUndef(v) })} />
        </>
      )
    case 'email':
      return (
        <>
          <Input label="Placeholder" value={q.settings.placeholder ?? ''} disabled={disabled} onChange={(e) => set({ placeholder: e.target.value || undefined }, k('placeholder'))} />
          <Check label="Ask to type the email twice" checked={!!q.settings.confirm} disabled={disabled} onChange={(v) => set({ confirm: v || undefined })} />
        </>
      )
    case 'phone':
      return (
        <Input
          label="Default country"
          hint="Two letter code, for example US."
          maxLength={2}
          value={q.settings.default_country}
          disabled={disabled}
          onChange={(e) => set({ default_country: e.target.value.toUpperCase() }, k('country'))}
        />
      )
    case 'number':
      return (
        <>
          <NumberField label="Decimal places" min={0} max={6} value={q.settings.decimals} disabled={disabled} onChange={(v) => set({ decimals: numOrUndef(v) })} />
          <Input label="Prefix" hint="Display only, for example $." value={q.settings.prefix ?? ''} disabled={disabled} onChange={(e) => set({ prefix: e.target.value || undefined }, k('prefix'))} />
          <Input label="Suffix" value={q.settings.suffix ?? ''} disabled={disabled} onChange={(e) => set({ suffix: e.target.value || undefined }, k('suffix'))} />
        </>
      )
    case 'single_choice':
    case 'dropdown': {
      const correct = q.settings.correct_option_id
      return (
        <>
          <OptionsEditor<ChoiceOption>
            title="Options"
            kind="option"
            items={q.settings.options}
            disabled={disabled}
            bulk={q.type === 'dropdown'}
            onChange={(options) => set({ options, correct_option_id: options.some((o) => o.id === correct) ? correct : undefined })}
            extra={(o, up) => (
              <div className="flex flex-col gap-1">
                <NumberField label="Score" value={o.score} disabled={disabled} onChange={(v) => up({ score: numOrUndef(v) })} />
                {q.type === 'single_choice' ? <Check label='Other with text box' checked={!!o.is_other} disabled={disabled} onChange={(v) => up({ is_other: v || undefined })} /> : null}
                <Check label="Keep last when shuffled" checked={!!o.pin_last} disabled={disabled} onChange={(v) => up({ pin_last: v || undefined })} />
              </div>
            )}
          />
          <Select
            label="Correct answer (quiz)"
            placeholder="No correct answer"
            options={q.settings.options.map((o) => ({ value: o.id, label: o.label || o.id }))}
            value={correct ?? ''}
            disabled={disabled}
            onChange={(e) => set({ correct_option_id: e.target.value || undefined })}
          />
          <Check label="Shuffle options" checked={q.settings.randomize} disabled={disabled} onChange={(v) => set({ randomize: v })} />
          {q.type === 'single_choice' ? (
            <Select
              label="Layout"
              options={[
                { value: 'list', label: 'List' },
                { value: 'columns', label: 'Columns' },
              ]}
              value={q.settings.layout ?? 'list'}
              disabled={disabled}
              onChange={(e) => set({ layout: e.target.value })}
            />
          ) : (
            <Check label="Searchable" checked={!!q.settings.searchable} disabled={disabled} onChange={(v) => set({ searchable: v })} />
          )}
        </>
      )
    }
    case 'multiple_choice': {
      const correct = new Set(q.settings.correct_option_ids ?? [])
      return (
        <>
          <OptionsEditor<ChoiceOption>
            title="Options"
            kind="option"
            items={q.settings.options}
            disabled={disabled}
            onChange={(options) => {
              const ids = [...correct].filter((id) => options.some((o) => o.id === id))
              set({ options, correct_option_ids: ids.length ? ids : undefined })
            }}
            extra={(o, up) => (
              <div className="flex flex-col gap-1">
                <NumberField label="Score" value={o.score} disabled={disabled} onChange={(v) => up({ score: numOrUndef(v) })} />
                <Check label="Other with text box" checked={!!o.is_other} disabled={disabled} onChange={(v) => up({ is_other: v || undefined })} />
                <Check label="Exclusive (for example None of the above)" checked={!!o.is_exclusive} disabled={disabled} onChange={(v) => up({ is_exclusive: v || undefined })} />
                <Check
                  label="Correct answer (quiz)"
                  checked={correct.has(o.id)}
                  disabled={disabled}
                  onChange={(v) => {
                    const next = new Set(correct)
                    if (v) next.add(o.id)
                    else next.delete(o.id)
                    set({ correct_option_ids: next.size ? [...next] : undefined })
                  }}
                />
              </div>
            )}
          />
          <Check label="Shuffle options" checked={q.settings.randomize} disabled={disabled} onChange={(v) => set({ randomize: v })} />
        </>
      )
    }
    case 'ranking':
      return (
        <>
          <OptionsEditor<ChoiceOption> title="Items to rank" kind="option" items={q.settings.options} disabled={disabled} onChange={(options) => set({ options })} />
          <Check label="Shuffle the starting order" checked={q.settings.randomize} disabled={disabled} onChange={(v) => set({ randomize: v })} />
          <NumberField label="Rank only the top N" min={1} value={q.settings.rank_top_n} disabled={disabled} onChange={(v) => set({ rank_top_n: numOrUndef(v) })} />
        </>
      )
    case 'yes_no':
      return (
        <>
          <Input label="Yes label" value={q.settings.yes_label} disabled={disabled} onChange={(e) => set({ yes_label: e.target.value }, k('yes'))} />
          <Input label="No label" value={q.settings.no_label} disabled={disabled} onChange={(e) => set({ no_label: e.target.value }, k('no'))} />
          <NumberField label="Score for yes" value={q.settings.yes_score} disabled={disabled} onChange={(v) => set({ yes_score: numOrUndef(v) })} />
          <NumberField label="Score for no" value={q.settings.no_score} disabled={disabled} onChange={(v) => set({ no_score: numOrUndef(v) })} />
        </>
      )
    case 'rating':
      return (
        <>
          <NumberField label="Points" min={3} max={10} value={q.settings.points} disabled={disabled} onChange={(v) => set({ points: Math.min(10, Math.max(3, Math.round(v ?? 5))) })} />
          <Select
            label="Display"
            options={[
              { value: 'stars', label: 'Stars' },
              { value: 'numbers', label: 'Numbers' },
              { value: 'emoji', label: 'Faces' },
              { value: 'slider', label: 'Slider' },
            ]}
            value={q.settings.display}
            disabled={disabled}
            onChange={(e) => set({ display: e.target.value })}
          />
          <Input label="Low end label" value={q.settings.min_label ?? ''} disabled={disabled} onChange={(e) => set({ min_label: e.target.value || undefined }, k('min'))} />
          <Input label="High end label" value={q.settings.max_label ?? ''} disabled={disabled} onChange={(e) => set({ max_label: e.target.value || undefined }, k('max'))} />
        </>
      )
    case 'nps':
      return (
        <>
          <Input label="Low end label" value={q.settings.min_label ?? ''} disabled={disabled} onChange={(e) => set({ min_label: e.target.value || undefined }, k('min'))} />
          <Input label="High end label" value={q.settings.max_label ?? ''} disabled={disabled} onChange={(e) => set({ max_label: e.target.value || undefined }, k('max'))} />
        </>
      )
    case 'matrix':
      return (
        <>
          <OptionsEditor title="Rows" kind="row" items={q.settings.rows} disabled={disabled} onChange={(rows) => set({ rows })} />
          <OptionsEditor<MatrixColumn>
            title="Columns"
            kind="column"
            items={q.settings.columns}
            disabled={disabled}
            onChange={(columns) => set({ columns })}
            extra={(c, up) => <NumberField label="Score" value={c.score} disabled={disabled} onChange={(v) => up({ score: numOrUndef(v) })} />}
          />
          <Check label="Shuffle rows" checked={q.settings.randomize_rows} disabled={disabled} onChange={(v) => set({ randomize_rows: v })} />
          <Check label="Every row needs an answer" checked={q.settings.all_rows_required} disabled={disabled} onChange={(v) => set({ all_rows_required: v })} />
        </>
      )
    case 'date':
      return (
        <>
          <Select
            label="Date format"
            options={[
              { value: 'MDY', label: 'Month, day, year' },
              { value: 'DMY', label: 'Day, month, year' },
              { value: 'YMD', label: 'Year, month, day' },
            ]}
            value={q.settings.display_format}
            disabled={disabled}
            onChange={(e) => set({ display_format: e.target.value })}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Days that cannot be picked</legend>
            {WEEKDAYS.map((d, i) => {
              const days = new Set(q.settings.disabled_weekdays ?? [])
              return (
                <Check
                  key={d}
                  label={d}
                  checked={days.has(i)}
                  disabled={disabled}
                  onChange={(v) => {
                    if (v) days.add(i)
                    else days.delete(i)
                    set({ disabled_weekdays: days.size ? [...days].sort() : undefined })
                  }}
                />
              )
            })}
          </fieldset>
        </>
      )
    case 'time':
      return (
        <Select
          label="Minute step"
          options={[1, 5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: `${n} minutes` }))}
          value={String(q.settings.minute_step)}
          disabled={disabled}
          onChange={(e) => set({ minute_step: Number(e.target.value) })}
        />
      )
    case 'file_upload':
      return <p className="text-sm text-muted">Set allowed file types, size and count on the Validation tab.</p>
    case 'signature':
      return <Input label="Pen color" type="color" value={q.settings.pen_color ?? '#000000'} disabled={disabled} onChange={(e) => set({ pen_color: e.target.value }, k('pen'))} />
    case 'address':
      return (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Required parts</legend>
            {ADDRESS_PARTS.map((p) => (
              <Check
                key={p}
                label={ADDRESS_LABELS[p]}
                checked={!!q.settings.parts_required[p]}
                disabled={disabled}
                onChange={(v) => set({ parts_required: clean({ ...q.settings.parts_required, [p]: v || undefined }) })}
              />
            ))}
          </fieldset>
          <Input
            label="Default country"
            maxLength={2}
            value={q.settings.default_country ?? ''}
            disabled={disabled}
            onChange={(e) => set({ default_country: e.target.value.toUpperCase() || undefined }, k('country'))}
          />
          <Check label="Lock the country" checked={!!q.settings.lock_country} disabled={disabled} onChange={(v) => set({ lock_country: v || undefined })} />
        </>
      )
    case 'consent':
      return (
        <>
          <Select
            label="Agreement text"
            options={[
              { value: 'workspace', label: 'Workspace consent text' },
              { value: 'custom', label: 'Custom text' },
            ]}
            value={q.settings.text_source}
            disabled={disabled}
            onChange={(e) => set({ text_source: e.target.value, custom_text: e.target.value === 'custom' ? (q.settings.custom_text ?? { format: 'md-lite', text: '' }) : undefined })}
          />
          {q.settings.text_source === 'custom' ? (
            <TextArea
              label="Custom text"
              hint="Supports **bold**, *italic* and [links](https://example.org)."
              value={q.settings.custom_text?.text ?? ''}
              disabled={disabled}
              onChange={(e) => set({ custom_text: { format: 'md-lite', text: e.target.value } }, k('custom'))}
            />
          ) : null}
        </>
      )
    case 'hidden':
      return (
        <>
          <Input
            label="URL parameter"
            hint="Captured from ?name=value on the survey link."
            value={q.settings.param}
            disabled={disabled}
            onChange={(e) => set({ param: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '') }, k('param'))}
          />
          <Input label="Default value" value={q.settings.default_value ?? ''} disabled={disabled} onChange={(e) => set({ default_value: e.target.value || undefined }, k('default'))} />
        </>
      )
    case 'calculated': {
      const parsed = parseFormula(q.settings.formula_source, definition)
      return (
        <>
          <TextArea
            label="Formula"
            hint="Use + - * / and parentheses, answers like {{q:q_abcd1234}}, min(), max(), round(x, 2), score(...) and correct(...)."
            value={q.settings.formula_source}
            error={parsed.ok ? undefined : parsed.error}
            disabled={disabled}
            onChange={(e) => {
              const src = e.target.value
              const r = parseFormula(src, definition)
              set(r.ok ? { formula_source: src, formula: r.expr } : { formula_source: src }, k('formula'))
            }}
          />
          <PipingPicker
            definition={definition}
            pageIndex={null}
            label="Insert a reference"
            disabled={disabled}
            onInsert={(t) => {
              const src = `${q.settings.formula_source} ${t}`.trim()
              const r = parseFormula(src, definition)
              set(r.ok ? { formula_source: src, formula: r.expr } : { formula_source: src })
            }}
          />
          <Check label="Show the result to respondents" checked={q.settings.visible} disabled={disabled} onChange={(v) => set({ visible: v })} />
          <NumberField label="Decimal places" min={0} max={6} value={q.settings.decimals} disabled={disabled} onChange={(v) => set({ decimals: numOrUndef(v) })} />
        </>
      )
    }
    case 'statement':
      return (
        <>
          <TextArea label="Text" rows={5} value={q.settings.body.text} disabled={disabled} onChange={(e) => set({ body: { format: 'md-lite', text: e.target.value } }, k('body'))} />
          <PipingPicker definition={definition} pageIndex={pageIndex} disabled={disabled} onInsert={(t) => set({ body: { format: 'md-lite', text: `${q.settings.body.text}${t}` } })} />
        </>
      )
    case 'image':
      return (
        <>
          <Input label="Image path" hint="Storage path in the workspace assets bucket." value={q.settings.path} disabled={disabled} onChange={(e) => set({ path: e.target.value }, k('path'))} />
          <Input label="Alternative text" required value={q.settings.alt} disabled={disabled} onChange={(e) => set({ alt: e.target.value }, k('alt'))} />
          <Select
            label="Width"
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'full', label: 'Full width' },
            ]}
            value={q.settings.width}
            disabled={disabled}
            onChange={(e) => set({ width: e.target.value })}
          />
          <Input label="Link (optional)" type="url" value={q.settings.href ?? ''} disabled={disabled} onChange={(e) => set({ href: e.target.value || undefined }, k('href'))} />
        </>
      )
  }
}
