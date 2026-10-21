import type { CSSProperties, ReactNode } from 'react'
import type { Theme } from '@/lib/survey'
import { cx } from '@/components/ui/cx'
import { themeToCssVars } from './theme'

/**
 * Writes the Theme as CSS custom properties on the renderer root. Tailwind
 * utilities inside reference them (bg-[var(--sv-surface)] and the remapped
 * --color-* tokens). Fonts are loaded by the page: pass its next/font class.
 */
export function ThemeProvider({
  theme,
  fontClassName,
  className,
  children,
}: {
  theme: Theme
  fontClassName?: string
  className?: string
  children: ReactNode
}) {
  const style = themeToCssVars(theme) as CSSProperties
  return (
    <div
      data-sv-root=""
      style={style}
      className={cx(
        'min-h-full bg-[var(--sv-background)] text-[var(--sv-on-background)] [font-family:var(--sv-font)] [font-size:var(--sv-base-size)]',
        fontClassName,
        className,
      )}
    >
      {children}
    </div>
  )
}
