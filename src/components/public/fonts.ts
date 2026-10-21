import { IBM_Plex_Sans, Inter, Lato, Merriweather, Open_Sans, Poppins, Roboto, Source_Serif_4, Work_Sans } from 'next/font/google'
import type { SafeFont, Theme } from '@/lib/survey'

/**
 * The self-hosted survey font set (doc 02 section 11). next/font downloads
 * the files at build time and serves them from this origin, so a respondent
 * never requests Google Fonts. preload is off: only the family a survey uses
 * is fetched, when its text first renders, with display swap.
 *
 * next/font hashes family names, while the renderer's theme writes
 * `--sv-font: 'Inter', system-ui` inline. fontStyle() returns a rule that
 * points those variables at the hashed families; `!important` in a
 * stylesheet is what beats the inline style ThemeProvider sets.
 */

const inter = Inter({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-inter' })
const roboto = Roboto({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-roboto' })
const openSans = Open_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-open-sans' })
const lato = Lato({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', preload: false, variable: '--sv-ff-lato' })
const sourceSerif = Source_Serif_4({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-source-serif' })
const merriweather = Merriweather({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-merriweather' })
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', preload: false, variable: '--sv-ff-poppins' })
const workSans = Work_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-work-sans' })
const plex = IBM_Plex_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--sv-ff-plex' })

type Loaded = { variable: string; cssVar: string; fallback: string }

const FONTS: Record<Exclude<SafeFont, 'system-ui'>, Loaded> = {
  Inter: { variable: inter.variable, cssVar: '--sv-ff-inter', fallback: 'system-ui, sans-serif' },
  Roboto: { variable: roboto.variable, cssVar: '--sv-ff-roboto', fallback: 'system-ui, sans-serif' },
  'Open Sans': { variable: openSans.variable, cssVar: '--sv-ff-open-sans', fallback: 'system-ui, sans-serif' },
  Lato: { variable: lato.variable, cssVar: '--sv-ff-lato', fallback: 'system-ui, sans-serif' },
  'Source Serif 4': { variable: sourceSerif.variable, cssVar: '--sv-ff-source-serif', fallback: 'Georgia, serif' },
  Merriweather: { variable: merriweather.variable, cssVar: '--sv-ff-merriweather', fallback: 'Georgia, serif' },
  Poppins: { variable: poppins.variable, cssVar: '--sv-ff-poppins', fallback: 'system-ui, sans-serif' },
  'Work Sans': { variable: workSans.variable, cssVar: '--sv-ff-work-sans', fallback: 'system-ui, sans-serif' },
  'IBM Plex Sans': { variable: plex.variable, cssVar: '--sv-ff-plex', fallback: 'system-ui, sans-serif' },
}

function stack(font: SafeFont): { variable: string | null; value: string } {
  if (font === 'system-ui') return { variable: null, value: 'system-ui, sans-serif' }
  const f = FONTS[font] ?? null
  if (!f) return { variable: null, value: 'system-ui, sans-serif' }
  return { variable: f.variable, value: `var(${f.cssVar}), ${f.fallback}` }
}

export const FONT_SCOPE_CLASS = 'sv-public-fonts'

/** Class names for ThemeProvider plus the CSS rule that maps the theme variables to them. */
export function themeFonts(theme: Pick<Theme, 'font'> | undefined): { className: string; css: string } {
  const body = stack(theme?.font?.body ?? 'system-ui')
  const heading = stack(theme?.font?.heading ?? 'system-ui')
  const classes = new Set([FONT_SCOPE_CLASS])
  if (body.variable) classes.add(body.variable)
  if (heading.variable) classes.add(heading.variable)
  const css = `[data-sv-root].${FONT_SCOPE_CLASS}{--sv-font:${body.value} !important;--sv-font-heading:${heading.value} !important}`
  return { className: [...classes].join(' '), css }
}
