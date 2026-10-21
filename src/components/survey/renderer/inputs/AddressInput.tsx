'use client'

import { ADDRESS_PARTS, type AddressPart, type AddressQuestion } from '@/lib/survey'
import { Input } from '@/components/ui/Input'
import type { InputProps } from '../types'
import type { RendererStrings } from '../strings'

const AUTOCOMPLETE: Record<AddressPart, string> = {
  line1: 'address-line1',
  line2: 'address-line2',
  city: 'address-level2',
  region: 'address-level1',
  postal: 'postal-code',
  country: 'country-name',
}

export function addressPartLabel(part: AddressPart, s: RendererStrings): string {
  const map: Record<AddressPart, string> = {
    line1: s.addressLine1,
    line2: s.addressLine2,
    city: s.addressCity,
    region: s.addressRegion,
    postal: s.addressPostal,
    country: s.addressCountry,
  }
  return map[part]
}

function asAddress(v: unknown): Partial<Record<AddressPart, string>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Partial<Record<AddressPart, string>> = {}
  for (const p of ADDRESS_PARTS) {
    const x = (v as Record<string, unknown>)[p]
    if (typeof x === 'string') out[p] = x
  }
  return out
}

/**
 * One labelled field per part. Decision: the default country is written into
 * the answer with the first edit, and a locked country is read-only.
 */
export function AddressInput({ question, value, onChange, inputId, describedBy, errors, ctx }: InputProps<AddressQuestion>) {
  const a = asAddress(value)
  const { parts_required, default_country, lock_country } = question.settings
  const badParts = new Set(errors.map((e) => e.part).filter(Boolean))
  const set = (part: AddressPart, v: string) => {
    const next = { ...a, [part]: v }
    if (next.country === undefined && default_country) next.country = default_country
    onChange(next)
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-describedby={describedBy}>
      {ADDRESS_PARTS.map((part, i) => {
        const locked = part === 'country' && lock_country === true && !!default_country
        const shown = part === 'country' ? (a.country ?? default_country ?? '') : (a[part] ?? '')
        return (
          <div key={part} className={part === 'line1' || part === 'line2' ? 'sm:col-span-2' : undefined}>
            <Input
              id={i === 0 ? inputId : `${inputId}-${part}`}
              label={addressPartLabel(part, ctx.strings)}
              required={parts_required[part] === true}
              autoComplete={AUTOCOMPLETE[part]}
              className="h-11 text-base rounded-[var(--sv-radius)]"
              value={shown}
              readOnly={locked}
              aria-invalid={badParts.has(part) || undefined}
              aria-describedby={describedBy}
              onChange={(e) => set(part, e.target.value)}
            />
          </div>
        )
      })}
    </div>
  )
}
