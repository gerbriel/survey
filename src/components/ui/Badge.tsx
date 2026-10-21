import type { HTMLAttributes } from 'react'
import { cx } from './cx'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'border-border text-muted',
  accent: 'border-accent text-accent',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
}

/** Status label. Meaning is in the text, never in the color alone. */
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone], className)}
      {...rest}
    />
  )
}
