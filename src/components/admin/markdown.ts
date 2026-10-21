/**
 * Minimal Markdown for the organization privacy notice preview (doc 05
 * section 7.1). Pure, unit tested, no HTML passthrough: the output is a tree
 * that MarkdownView renders as React elements, so nothing in the text can
 * become markup. Supports #, ##, ### headings, paragraphs, - and 1. lists,
 * **bold**, *italic*, `code`, and [links](https://...) (https and mailto only).
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }

export function safeHref(href: string): string | null {
  const h = href.trim()
  return /^(https:\/\/|mailto:)[^\s]+$/i.test(h) ? h : null
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush()
      out.push({ t: 'code', v: m[1] ?? '' })
      i += m[0].length
    } else if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
      flush()
      out.push({ t: 'strong', c: parseInline(m[1] ?? '') })
      i += m[0].length
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush()
      out.push({ t: 'em', c: parseInline(m[1] ?? '') })
      i += m[0].length
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const href = safeHref(m[2] ?? '')
      flush()
      if (href) out.push({ t: 'link', href, c: parseInline(m[1] ?? '') })
      else out.push({ t: 'text', v: m[1] ?? '' })
      i += m[0].length
    } else {
      buf += src[i]
      i++
    }
  }
  flush()
  return out
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  const endList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) })
    list = null
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      endPara()
      endList()
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (h) {
      endPara()
      endList()
      blocks.push({ t: 'h', level: (h[1]?.length ?? 1) as 1 | 2 | 3, c: parseInline(h[2] ?? '') })
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(trimmed)
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (ul || ol) {
      endPara()
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.t !== kind) {
        endList()
        list = { t: kind, items: [] }
      }
      list.items.push((ul ?? ol)?.[1] ?? '')
      continue
    }
    endList()
    para.push(trimmed)
  }
  endPara()
  endList()
  return blocks
}
