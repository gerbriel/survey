import { describe, expect, it } from 'vitest'
import { hashString, mulberry32, rngFor, shuffleWithPins } from '../random'

describe('random', () => {
  it('hashString is stable FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })

  it('mulberry32 yields floats in [0,1) deterministically', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('property: shuffle is a permutation, deterministic per seed, pins stay', () => {
    const items = Array.from({ length: 12 }, (_, i) => `i${i}`)
    const pinned = new Set(['i0', 'i5', 'i11'])
    const orders = new Set<string>()
    for (let s = 0; s < 300; s++) {
      const seed = `seed${s}`
      const a = shuffleWithPins(items, rngFor(seed, 'q'), (x) => pinned.has(x))
      const b = shuffleWithPins(items, rngFor(seed, 'q'), (x) => pinned.has(x))
      expect(a).toEqual(b)
      expect([...a].sort()).toEqual([...items].sort())
      for (const p of pinned) expect(a.indexOf(p)).toBe(items.indexOf(p))
      orders.add(a.join(','))
    }
    // Different seeds actually produce different orders.
    expect(orders.size).toBeGreaterThan(250)
  })

  it('does not mutate its input and handles empty lists', () => {
    const items = ['a', 'b', 'c']
    shuffleWithPins(items, mulberry32(3), () => false)
    expect(items).toEqual(['a', 'b', 'c'])
    expect(shuffleWithPins([], mulberry32(3), () => false)).toEqual([])
  })
})
