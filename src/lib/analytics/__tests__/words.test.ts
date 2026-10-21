import { describe, expect, it } from 'vitest'
import { STOPWORDS_EN, wordFrequency } from '../words'

describe('wordFrequency', () => {
  it('drops stopwords and words of two letters or fewer', () => {
    expect(wordFrequency(['The app is ok and it works, really works'])).toEqual([
      { word: 'works', count: 2 },
      { word: 'app', count: 1 },
    ])
  })
  it('handles apostrophes: contractions match stopwords', () => {
    const w = wordFrequency(["I don't think it's great", "Don't change the colour's shade"])
    expect(w.map((x) => x.word)).not.toContain("don't")
    expect(w.map((x) => x.word)).toContain('great')
    expect(w.map((x) => x.word)).toContain("colour's")
  })
  it('sorts by count then alphabetically and honors the limit and minimum', () => {
    const w = wordFrequency(['zebra apple apple mango mango'], 2)
    expect(w).toEqual([
      { word: 'apple', count: 2 },
      { word: 'mango', count: 2 },
    ])
    expect(wordFrequency(['zebra apple apple'], 50, 2)).toEqual([{ word: 'apple', count: 2 }])
  })
  it('is case insensitive and unicode aware', () => {
    expect(wordFrequency(['Café CAFÉ café'])).toEqual([{ word: 'café', count: 3 }])
  })
  it('matches the SQL seed list', () => {
    for (const w of ['the', 'and', 'would', 'think', 'dont', 'thats']) expect(STOPWORDS_EN.has(w)).toBe(true)
  })
})
