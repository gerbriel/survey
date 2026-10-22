'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export type ExportAction = { id: string; label: string; body: unknown; ext: 'csv' | 'xlsx' }

/**
 * Export buttons that POST JSON to a route (Results hub bulk export,
 * Compare). A small export downloads directly; a large one comes back as a
 * 1 hour signed link once the server writes the file.
 */
export function PostExportButtons({ endpoint, actions, note }: { endpoint: string; actions: ExportAction[]; note?: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function run(a: ExportAction) {
    setBusy(a.id)
    setMessage('Preparing the export. Large exports can take a few minutes.')
    setLink(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.body) })
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('application/json')) {
        const data = (await res.json()) as { url?: string; error?: string; rows?: number }
        if (!res.ok || !data.url) {
          setMessage(data.error ?? 'The export failed. Try again.')
          return
        }
        setLink(data.url)
        setMessage(`Your export of ${data.rows?.toLocaleString('en-US') ?? 'all'} responses is ready. The link works for 1 hour.`)
        return
      }
      if (!res.ok) {
        setMessage('The export failed. Try again.')
        return
      }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `export.${a.ext}`
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url
      el.download = name
      el.click()
      URL.revokeObjectURL(url)
      setMessage(null)
    } catch {
      setMessage('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Button key={a.id} size="sm" variant="secondary" loading={busy === a.id} disabled={busy !== null} onClick={() => run(a)}>
            {a.label}
          </Button>
        ))}
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted">
        {message}{' '}
        {link ? (
          <a className="text-accent underline" href={link}>
            Download
          </a>
        ) : null}
      </p>
    </div>
  )
}
