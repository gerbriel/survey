'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Export buttons (doc 04 section 6). Viewers get the aggregate summary CSV;
 * editors also get row-level CSV and XLSX. Small exports download directly;
 * large ones come back as a signed link after the server writes the file.
 */
export function ExportButtons({ endpoint, query, canExportRows }: { endpoint: string; query: string; canExportRows: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function run(kind: 'responses' | 'summary', format: 'csv' | 'xlsx') {
    const id = `${kind}-${format}`
    setBusy(id)
    setMessage(kind === 'responses' ? 'Preparing the export. Large exports can take a few minutes.' : null)
    setLink(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, format, labels: true, query }),
      })
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
      const cd = res.headers.get('content-disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `export.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
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
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy === 'summary-csv'} disabled={busy !== null} onClick={() => run('summary', 'csv')}>
          Export summary CSV
        </Button>
        {canExportRows ? (
          <>
            <Button size="sm" variant="secondary" loading={busy === 'responses-csv'} disabled={busy !== null} onClick={() => run('responses', 'csv')}>
              Export responses CSV
            </Button>
            <Button size="sm" variant="secondary" loading={busy === 'responses-xlsx'} disabled={busy !== null} onClick={() => run('responses', 'xlsx')}>
              Export XLSX
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          Print
        </Button>
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
