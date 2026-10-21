'use client'

import { isSafeRegex, type Question, type Validation } from '@/lib/survey'
import { Input } from '@/components/ui/Input'
import { Check, listToText, NumberField, textToList } from './fields'

function minutesToTime(m: number | undefined): string {
  if (m === undefined) return ''
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function timeToMinutes(s: string): number | undefined {
  const m = s.match(/^(\d{2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

function DateBound({ label, value, onChange, disabled }: { label: string; value: Validation['min_date']; onChange: (v: Validation['min_date']) => void; disabled?: boolean }) {
  const relative = typeof value === 'object'
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{label}</legend>
      <Check label="Relative to today" checked={relative} disabled={disabled} onChange={(v) => onChange(v ? { relative_days: 0 } : undefined)} />
      {relative ? (
        <NumberField
          label="Days from today (negative for the past)"
          value={value.relative_days}
          disabled={disabled}
          onChange={(v) => onChange({ relative_days: Math.round(v ?? 0) })}
        />
      ) : (
        <Input label="Date" type="date" value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
    </fieldset>
  )
}

/** Validation tab (doc 03 sections 1 and 4): rules per type. Loosening or tightening is a safe change. */
export function ValidationSettings({ question: q, onChange, disabled }: { question: Question; onChange: (q: Question, key?: string) => void; disabled?: boolean }) {
  const v = q.validation ?? {}
  const set = (patch: Partial<Validation>, key?: string) => {
    const next = Object.fromEntries(Object.entries({ ...v, ...patch }).filter(([, x]) => x !== undefined)) as Validation
    const { validation: _drop, ...rest } = q
    void _drop
    onChange((Object.keys(next).length ? { ...rest, validation: next } : rest) as Question, key)
  }
  const k = (n: string) => `${q.id}:validation:${n}`

  switch (q.type) {
    case 'short_text':
    case 'long_text':
    case 'email': {
      const pattern = v.pattern
      const badRegex = pattern ? !isSafeRegex(pattern.regex) : false
      return (
        <>
          <NumberField label="Minimum length" min={0} value={v.min_length} disabled={disabled} onChange={(x) => set({ min_length: x })} />
          <NumberField label="Maximum length" min={1} value={v.max_length} disabled={disabled} onChange={(x) => set({ max_length: x })} />
          {q.type === 'short_text' ? (
            <>
              <Input
                label="Pattern (regular expression)"
                value={pattern?.regex ?? ''}
                error={badRegex ? 'This pattern is invalid, too long, or may be slow.' : undefined}
                disabled={disabled}
                onChange={(e) =>
                  set({ pattern: e.target.value ? { regex: e.target.value, message: pattern?.message ?? 'Please match the requested format.', ...(pattern?.flags ? { flags: pattern.flags } : {}) } : undefined }, k('regex'))
                }
              />
              {pattern ? (
                <>
                  <Input label="Message when it does not match" value={pattern.message} disabled={disabled} onChange={(e) => set({ pattern: { ...pattern, message: e.target.value } }, k('message'))} />
                  <Check
                    label="Ignore upper and lower case"
                    checked={pattern.flags === 'i'}
                    disabled={disabled}
                    onChange={(on) => set({ pattern: on ? { ...pattern, flags: 'i' } : { regex: pattern.regex, message: pattern.message } })}
                  />
                </>
              ) : null}
            </>
          ) : null}
          {q.type === 'email' ? (
            <>
              <Input
                label="Allowed domains"
                hint="Comma separated, for example example.org"
                value={listToText(v.allowed_email_domains)}
                disabled={disabled}
                onChange={(e) => set({ allowed_email_domains: textToList(e.target.value) }, k('allowed'))}
              />
              <Input label="Blocked domains" hint="Comma separated" value={listToText(v.blocked_email_domains)} disabled={disabled} onChange={(e) => set({ blocked_email_domains: textToList(e.target.value) }, k('blocked'))} />
            </>
          ) : null}
        </>
      )
    }
    case 'number':
      return (
        <>
          <NumberField label="Minimum" value={v.min} disabled={disabled} onChange={(x) => set({ min: x })} />
          <NumberField label="Maximum" value={v.max} disabled={disabled} onChange={(x) => set({ max: x })} />
          <Check label="Whole numbers only" checked={!!v.integer} disabled={disabled} onChange={(x) => set({ integer: x || undefined })} />
        </>
      )
    case 'multiple_choice':
      return (
        <>
          <NumberField label="Minimum selections" min={0} value={v.min_selections} disabled={disabled} onChange={(x) => set({ min_selections: x })} />
          <NumberField label="Maximum selections" min={1} value={v.max_selections} disabled={disabled} onChange={(x) => set({ max_selections: x })} />
        </>
      )
    case 'date':
      return (
        <>
          <DateBound label="Earliest date" value={v.min_date} disabled={disabled} onChange={(x) => set({ min_date: x })} />
          <DateBound label="Latest date" value={v.max_date} disabled={disabled} onChange={(x) => set({ max_date: x })} />
        </>
      )
    case 'time':
      return (
        <>
          <Input label="Earliest time" type="time" value={minutesToTime(v.min)} disabled={disabled} onChange={(e) => set({ min: timeToMinutes(e.target.value) })} />
          <Input label="Latest time" type="time" value={minutesToTime(v.max)} disabled={disabled} onChange={(e) => set({ max: timeToMinutes(e.target.value) })} />
        </>
      )
    case 'file_upload':
      return (
        <>
          <Input
            label="Allowed file extensions"
            hint="Comma separated, for example pdf, png, jpg"
            value={listToText(v.allowed_extensions)}
            disabled={disabled}
            onChange={(e) => set({ allowed_extensions: textToList(e.target.value.toLowerCase()) }, k('ext'))}
          />
          <NumberField label="Maximum size per file (MB)" min={1} max={25} value={v.max_file_mb} disabled={disabled} onChange={(x) => set({ max_file_mb: x })} />
          <NumberField label="Maximum number of files" min={1} max={20} value={v.max_files} disabled={disabled} onChange={(x) => set({ max_files: x })} />
        </>
      )
    default:
      return <p className="text-sm text-muted">This type has no extra validation rules.</p>
  }
}
