import type { ReactNode } from 'react'
import { cx, focusRing } from '@/components/ui/cx'
import { controlClass } from '@/components/ui/Field'

/** Text control: shared primitive styles, 16px text so mobile browsers never zoom, 44px tall. */
export const textControl = cx(controlClass, focusRing, 'h-11 text-base rounded-[var(--sv-radius)]')

/** A selectable row for radios and checkboxes: whole row is the 44px tap target. */
export const choiceRow = cx(
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--sv-radius)] border border-border px-3 py-2',
  'has-[:checked]:border-[var(--sv-primary)] has-[:checked]:bg-[color-mix(in_srgb,var(--sv-primary)_8%,transparent)]',
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
)

/** Native radio and checkbox tinted with the theme color. */
export const nativeCheck = 'size-5 shrink-0 accent-[var(--sv-primary)] focus-visible:outline-none'

export function Hint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-muted">
      {children}
    </p>
  )
}

export function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

export function joinIds(...ids: Array<string | undefined | false>): string | undefined {
  const s = ids.filter(Boolean).join(' ')
  return s === '' ? undefined : s
}
