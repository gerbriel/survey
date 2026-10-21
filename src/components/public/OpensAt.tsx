'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'

const noop = () => () => {}

/**
 * "Opens {date}" in the viewer's time zone (doc 02 section 3). The server
 * renders UTC; the client swaps in local time after hydration. When opening
 * within the hour the page refreshes itself at opens_at.
 */
export function OpensAt({ iso }: { iso: string }) {
  const router = useRouter()
  const isClient = useSyncExternalStore(noop, () => true, () => false)
  const date = new Date(iso)
  const label = Number.isNaN(date.getTime())
    ? iso
    : isClient
      ? date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
      : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`

  useEffect(() => {
    const ms = new Date(iso).getTime() - Date.now()
    if (!Number.isFinite(ms) || ms > 60 * 60 * 1000) return
    const t = setTimeout(() => router.refresh(), Math.max(ms, 0) + 1000)
    return () => clearTimeout(t)
  }, [iso, router])

  return (
    <>
      Opens <time dateTime={iso}>{label}</time>.
    </>
  )
}
