import type { ReactNode } from 'react'
import { parseMarkdown, type Inline } from './markdown'

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return (
          <code key={i} className="rounded bg-surface-muted px-1">
            {n.v}
          </code>
        )
      case 'strong':
        return <strong key={i}>{renderInline(n.c)}</strong>
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>
      case 'link':
        return (
          <a key={i} href={n.href} className="text-accent underline underline-offset-2" rel="noopener noreferrer" target="_blank">
            {renderInline(n.c)}
          </a>
        )
    }
  })
}

/** Renders the safe Markdown subset as React elements. Headings start at h2 inside a page. */
export function MarkdownView({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return <p className="text-sm text-muted">Nothing to preview yet.</p>
  return (
    <div className="flex flex-col gap-3 text-sm leading-6">
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          const cls = b.level === 1 ? 'text-xl font-semibold' : b.level === 2 ? 'text-lg font-semibold' : 'font-semibold'
          if (b.level === 1) return <h2 key={i} className={cls}>{renderInline(b.c)}</h2>
          if (b.level === 2) return <h3 key={i} className={cls}>{renderInline(b.c)}</h3>
          return <h4 key={i} className={cls}>{renderInline(b.c)}</h4>
        }
        if (b.t === 'p') return <p key={i}>{renderInline(b.c)}</p>
        const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)
        return b.t === 'ul' ? (
          <ul key={i} className="list-disc pl-6">
            {items}
          </ul>
        ) : (
          <ol key={i} className="list-decimal pl-6">
            {items}
          </ol>
        )
      })}
    </div>
  )
}
