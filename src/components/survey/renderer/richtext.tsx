/**
 * md-lite (doc 03 section 2): bold, italic, links, line breaks. Piped values
 * are swapped for private-use placeholders before parsing and come back as
 * plain text nodes, so a piped "**x**" or "<b>" is never markup.
 */

import { Fragment, type ReactNode } from 'react'
import { resolvePipes, type EvalState, type PipeOptions, type RichText, type SurveyDefinition } from '@/lib/survey'

export type MdNode =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: MdNode[] }
  | { t: 'em'; c: MdNode[] }
  | { t: 'link'; href: string; c: MdNode[] }

const OPEN = ''
const CLOSE = ''
const PLACEHOLDER_RE = /(\d+)/g
const PRIVATE_RE = /[]/g

const INLINE: { re: RegExp; make: (m: RegExpExecArray) => MdNode }[] = [
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, make: (m) => ({ t: 'link', href: m[2] as string, c: parseInline(m[1] as string) }) },
  { re: /\*\*([^*\n]+?)\*\*/, make: (m) => ({ t: 'strong', c: parseInline(m[1] as string) }) },
  { re: /\*([^*\n]+?)\*|_([^_\n]+?)_/, make: (m) => ({ t: 'em', c: parseInline((m[1] ?? m[2]) as string) }) },
]

function parseInline(s: string): MdNode[] {
  const out: MdNode[] = []
  let rest = s
  while (rest.length > 0) {
    let best: { idx: number; m: RegExpExecArray; make: (m: RegExpExecArray) => MdNode } | null = null
    for (const p of INLINE) {
      const m = p.re.exec(rest)
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, m, make: p.make }
    }
    if (!best) {
      out.push({ t: 'text', v: rest })
      break
    }
    if (best.idx > 0) out.push({ t: 'text', v: rest.slice(0, best.idx) })
    out.push(best.make(best.m))
    rest = rest.slice(best.idx + best.m[0].length)
  }
  return out
}

export function parseMdLite(text: string): MdNode[] {
  const out: MdNode[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (i > 0) out.push({ t: 'br' })
    out.push(...parseInline(line))
  })
  return out
}

/** Only https and mailto links render as links (doc 02 section 10). */
export function safeHref(href: string): string | null {
  try {
    const u = new URL(href)
    return u.protocol === 'https:' || u.protocol === 'mailto:' ? u.toString() : null
  } catch {
    return null
  }
}

function fill(s: string, values: string[]): string {
  return s.replace(PLACEHOLDER_RE, (_m, i: string) => values[Number(i)] ?? '')
}

function renderNodes(nodes: MdNode[], values: string[], keyBase: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`
    switch (n.t) {
      case 'br':
        return <br key={key} />
      case 'text':
        // Text nodes only: React escapes them.
        return <Fragment key={key}>{fill(n.v, values)}</Fragment>
      case 'strong':
        return <strong key={key}>{renderNodes(n.c, values, key)}</strong>
      case 'em':
        return <em key={key}>{renderNodes(n.c, values, key)}</em>
      case 'link': {
        const href = safeHref(fill(n.href, values))
        const body = renderNodes(n.c, values, key)
        if (!href) return <Fragment key={key}>{body}</Fragment>
        // Decision: links open in a new tab so a click never loses survey progress (doc 02 section 9).
        return (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {body}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      }
    }
  })
}

/** Template text with tokens replaced by placeholders, plus the piped values. */
function withPlaceholders(text: string, definition?: SurveyDefinition, state?: EvalState, opts?: PipeOptions): { template: string; values: string[] } {
  const clean = text.replace(PRIVATE_RE, '')
  if (!definition || !state) return { template: clean, values: [] }
  const values: string[] = []
  const template = resolvePipes(clean, definition, state, opts)
    .map((seg) => {
      if (seg.kind === 'text') return seg.text
      values.push(seg.text)
      return `${OPEN}${values.length - 1}${CLOSE}`
    })
    .join('')
  return { template, values }
}

export function RichTextView({
  text,
  definition,
  state,
  pipe,
}: {
  text: RichText | string | undefined
  definition?: SurveyDefinition
  state?: EvalState
  pipe?: PipeOptions
}) {
  if (text === undefined) return null
  const raw = typeof text === 'string' ? text : text.text
  const { template, values } = withPlaceholders(raw, definition, state, pipe)
  return <>{renderNodes(parseMdLite(template), values, 'md')}</>
}

/** Plain text (markup stripped, tokens piped) for summaries and aria labels. */
export function richTextPlain(text: RichText | string | undefined, definition?: SurveyDefinition, state?: EvalState, pipe?: PipeOptions): string {
  if (text === undefined) return ''
  const raw = typeof text === 'string' ? text : text.text
  const { template, values } = withPlaceholders(raw, definition, state, pipe)
  const flat = (nodes: MdNode[]): string =>
    nodes.map((n) => (n.t === 'text' ? fill(n.v, values) : n.t === 'br' ? ' ' : flat(n.c))).join('')
  return flat(parseMdLite(template)).replace(/\s+/g, ' ').trim()
}
