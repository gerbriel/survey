/** Small numeric helpers shared by the aggregates. Pure. */

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let s = 0
  for (const v of values) s += v
  return round(s / values.length, 2)
}

/** Linear interpolation median, same as percentile_cont(0.5). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = (s.length - 1) / 2
  const lo = s[Math.floor(mid)]!
  const hi = s[Math.ceil(mid)]!
  return round((lo + hi) / 2, 2)
}

export function round(v: number, places = 0): number {
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** Percentage of part in base, one decimal, 0 when base is 0. */
export function pct(part: number, base: number): number {
  return base > 0 ? round((100 * part) / base, 1) : 0
}

/**
 * Decision: auto bins use the Freedman-Diaconis width, capped to 5 to 20
 * bins, with integer edges when every value is an integer. Single valued
 * data gets one bin.
 */
export function histogram(values: number[]): { from: number; to: number; count: number }[] {
  if (values.length === 0) return []
  const s = [...values].sort((a, b) => a - b)
  const min = s[0]!
  const max = s[s.length - 1]!
  if (min === max) return [{ from: min, to: max, count: s.length }]
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!
  const iqr = q(0.75) - q(0.25)
  const fd = iqr > 0 ? 2 * iqr * Math.cbrt(1 / s.length) : 0
  let bins = fd > 0 ? Math.ceil((max - min) / fd) : Math.ceil(Math.sqrt(s.length))
  bins = Math.max(5, Math.min(20, bins))
  const allInt = s.every((v) => Number.isInteger(v))
  let width = (max - min) / bins
  if (allInt) {
    width = Math.max(1, Math.ceil(width))
    bins = Math.ceil((max - min + 1) / width)
  }
  const out = Array.from({ length: bins }, (_, i) => ({
    from: round(min + i * width, 4),
    to: round(allInt ? min + (i + 1) * width - 1 : min + (i + 1) * width, 4),
    count: 0,
  }))
  for (const v of s) {
    const i = Math.min(bins - 1, Math.floor((v - min) / width))
    out[i]!.count++
  }
  return out
}
