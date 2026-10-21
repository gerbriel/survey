import type { WordCount } from './types'

/**
 * English stopwords, the same list migration 0009 seeds into `stopwords` so
 * the dashboard and the shared report agree on what counts as a word.
 */
export const STOPWORDS_EN: ReadonlySet<string> = new Set([
  'a','about','above','after','again','against','all','also','am','an','and','any','are','as','at','be','because',
  'been','before','being','below','between','both','but','by','can','could','did','do','does','doing','done','down',
  'during','each','even','ever','every','few','for','from','further','get','got','had','has','have','having','he',
  'her','here','hers','herself','him','himself','his','how','however','i','if','in','into','is','it','its','itself',
  'just','like','made','make','many','may','me','might','more','most','much','must','my','myself','no','nor','not',
  'now','of','off','on','once','one','only','or','other','our','ours','ourselves','out','over','own','really','same',
  'she','should','so','some','such','than','that','the','their','theirs','them','themselves','then','there','these',
  'they','thing','things','this','those','through','to','too','under','until','up','us','very','was','we','well',
  'were','what','when','where','which','while','who','whom','why','will','with','would','yes','yet','you','your',
  'yours','yourself','yourselves','dont','didnt','doesnt','isnt','wasnt','im','ive','thats','theres','cant',
  'wont','lot','lots','bit','still','way','go','going','know','think',
])

/**
 * Top words across answers, the doc 04 SQL in TypeScript: lowercase, split on
 * anything that is not a letter, digit or apostrophe, keep words longer than
 * two characters that are not stopwords. Apostrophes are stripped before the
 * stopword check so "don't" matches "dont". Ties sort alphabetically.
 */
export function wordFrequency(texts: Iterable<string>, limit = 50, minCount = 1): WordCount[] {
  const counts = new Map<string, number>()
  for (const t of texts) {
    for (const raw of t.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
      const w = raw.replace(/^'+|'+$/g, '')
      if (w.length <= 2) continue
      if (STOPWORDS_EN.has(w) || STOPWORDS_EN.has(w.replace(/'/g, ''))) continue
      counts.set(w, (counts.get(w) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}
