import type { ReactNode } from 'react'
import { coverSrc, normalizeCover, type Theme } from '@/lib/survey'
import { cx } from '@/components/ui/cx'

const LOGO_SIZE = { sm: 'h-8', md: 'h-12', lg: 'h-16' } as const

/** Logo URL for the theme: workspace logo (referenced live), custom Storage path, or none. */
export function logoSrc(theme: Theme, logoUrl: string | undefined, resolve?: (path: string) => string | null): string | null {
  if (theme.logo.source === 'workspace') return logoUrl ?? null
  if (theme.logo.source === 'custom' && theme.logo.custom_path) return resolve?.(theme.logo.custom_path) ?? null
  return null
}

/**
 * Page chrome: optional banner (preview), cover, logo, title, progress at the
 * theme position, the card or full layout, and a footer slot that Phase 2C
 * fills with Powered by, privacy and report links (doc 02 section 9).
 */
export function SurveyShell({
  theme,
  title,
  description,
  logoUrl,
  resolveAssetUrl,
  progress,
  banner,
  footer,
  children,
}: {
  theme: Theme
  title: ReactNode
  description?: ReactNode
  logoUrl?: string
  resolveAssetUrl?: (path: string) => string | null
  progress?: ReactNode
  banner?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const logo = logoSrc(theme, logoUrl, resolveAssetUrl)
  // Starter covers come from the app's /headers path, library and upload covers through resolveAssetUrl (doc 03 section 8.1).
  const coverImage = normalizeCover(theme.cover_image)
  const cover = coverSrc(coverImage, resolveAssetUrl)
  const bgImage = theme.background.kind === 'image' ? resolveAssetUrl?.(theme.background.path) : null
  const overlay = theme.background.kind === 'image' ? theme.background.overlay_opacity : 0
  const card = theme.layout === 'card'
  return (
    <div
      className="relative flex min-h-dvh flex-col bg-cover bg-center"
      style={bgImage ? { backgroundImage: `url(${JSON.stringify(bgImage)})` } : undefined}
    >
      {bgImage ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: overlay }} /> : null}
      <div className="relative flex flex-1 flex-col">
        {banner}
        {cover && coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage URL from the caller or an app starter.
          <img
            src={cover}
            alt=""
            className={cx('w-full object-cover', coverImage.height === 'tall' ? 'h-64' : 'h-32')}
            style={{ objectPosition: `50% ${Math.round(coverImage.focal_y * 100)}%` }}
          />
        ) : null}
        <div className={cx('mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-6', card ? 'max-w-2xl' : 'max-w-3xl')}>
          <header className={cx('flex flex-col gap-3', theme.logo.position === 'center' && 'items-center text-center')}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage URL from the caller.
              <img src={logo} alt="" className={cx('w-auto object-contain', LOGO_SIZE[theme.logo.size] ?? LOGO_SIZE.md)} />
            ) : null}
            <h1 className="text-2xl font-bold [font-family:var(--sv-font-heading)]">{title}</h1>
            {description ? <div className="text-[var(--sv-on-background)] opacity-90">{description}</div> : null}
          </header>
          {progress && theme.progress.position === 'top' ? progress : null}
          <main
            className={cx(
              'flex flex-col gap-6 text-[var(--sv-text)]',
              card ? 'rounded-[var(--sv-radius)] bg-[var(--sv-surface)] p-5 shadow-sm sm:p-8' : 'bg-[var(--sv-surface)] p-4',
            )}
          >
            {children}
          </main>
          {progress && theme.progress.position === 'bottom' ? progress : null}
          {footer ? <footer className="mt-auto pt-4 text-sm text-[var(--sv-on-background)]">{footer}</footer> : null}
        </div>
      </div>
    </div>
  )
}
