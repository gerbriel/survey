/** Number formatting for charts. Pure. */

export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (a >= 10_000) return `${trim(n / 1000)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function trim(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export function percent(p: number): string {
  return `${p.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

/** "<3" for suppressed cells, else the formatted number. */
export function cellText(v: number | '<3' | null | undefined): string {
  if (v === '<3') return '<3'
  if (v === null || v === undefined) return ''
  return v.toLocaleString('en-US')
}

export function duration(seconds: number | null): string {
  if (seconds === null) return 'No data'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Clean axis max: 1, 2, 5 times a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
