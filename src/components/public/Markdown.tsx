import type { ReactNode } from 'react'
import { RichTextView } from '@/components/survey/renderer'

/**
 * Safe markdown subset for the organization privacy notice (doc 05): `#` to
 * `###` headings, paragraphs, `-` or `*` and `1.` lists, and inline bold,
 * italic and https or mailto links through the renderer's md-lite
 * RichTextView. Everything renders as React text nodes; raw HTML is shown
 * as text, never parsed.
 */

type Block =
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }

export function parseBlocks(md: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join('\n') })
    para = []
    if (list) out.push(list)
    list = null
  }
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.+)$/.exec(line)
    const ul = /^\s*[-*]\s+(.+)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (!line.trim()) {
      flush()
    } else if (h) {
      flush()
      out.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! })
    } else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      if (para.length) {
        out.push({ t: 'p', text: para.join('\n') })
        para = []
      }
      if (!list || list.t !== kind) {
        if (list) out.push(list)
        list = { t: kind, items: [] }
      }
      list.items.push((ul ?? ol)![1]!)
    } else {
      if (list) {
        out.push(list)
        list = null
      }
      para.push(line)
    }
  }
  flush()
  return out
}

const H = { 1: 'text-2xl font-bold', 2: 'text-xl font-semibold', 3: 'text-lg font-semibold' } as const

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="flex flex-col gap-4 leading-relaxed">
      {blocks.map((b, i): ReactNode => {
        if (b.t === 'h') {
          // The page owns the h1; notice headings start at h2.
          const Tag = (`h${Math.min(b.level + 1, 4)}`) as 'h2' | 'h3' | 'h4'
          return (
            <Tag key={i} className={H[b.level]}>
              <RichTextView text={b.text} />
            </Tag>
          )
        }
        if (b.t === 'p') {
          return (
            <p key={i}>
              <RichTextView text={b.text} />
            </p>
          )
        }
        const List = b.t
        return (
          <List key={i} className={b.t === 'ul' ? 'list-disc pl-6' : 'list-decimal pl-6'}>
            {b.items.map((item, j) => (
              <li key={j}>
                <RichTextView text={item} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
