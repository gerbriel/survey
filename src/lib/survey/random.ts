/**
 * Seeded randomness (doc 03 section 3, Randomization). mulberry32 seeded from
 * a 32-bit FNV-1a hash of `response_seed + target_id`. No Math.random here so
 * the client and the server always produce the same order.
 */

/** 32-bit FNV-1a over UTF-16 code units. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngFor(responseSeed: string, targetId: string): () => number {
  return mulberry32(hashString(responseSeed + targetId))
}

/**
 * Fisher-Yates over the items whose `isPinned` is false. Pinned items keep
 * their index; the rest are permuted among the remaining slots.
 */
export function shuffleWithPins<T>(items: readonly T[], rng: () => number, isPinned: (item: T) => boolean): T[] {
  const out = items.slice()
  const slots: number[] = []
  for (let i = 0; i < out.length; i++) if (!isPinned(out[i] as T)) slots.push(i)
  const free = slots.map((i) => out[i] as T)
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = free[i] as T
    free[i] = free[j] as T
    free[j] = tmp
  }
  slots.forEach((slot, k) => {
    out[slot] = free[k] as T
  })
  return out
}
