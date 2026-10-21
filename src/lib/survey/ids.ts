/**
 * Id generators and validators (doc 03 section 2, doc 01 section 4).
 *
 * Every id is a prefix plus 8 characters of `[a-z0-9]`. question_key uses the
 * same shape as question ids: `q_` plus 8, which is what publish_survey_version
 * checks in SQL. Decision: doc 03 section 6 describes snake_case keys from the
 * label, but doc 01 (schema source, R11) and the SQL check use `^q_[a-z0-9]{8}$`,
 * so the SQL format wins.
 */

import { mulberry32, hashString } from './random'

export const ID_PREFIXES = {
  page: 'p_',
  question: 'q_',
  option: 'o_',
  row: 'r_',
  column: 'c_',
  ending: 'e_',
  logic: 'l_',
} as const

export type IdKind = keyof typeof ID_PREFIXES

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const BODY_LENGTH = 8

export const QUESTION_KEY_RE = /^q_[a-z0-9]{8}$/
const ID_RES: Record<IdKind, RegExp> = {
  page: /^p_[a-z0-9]{8}$/,
  question: QUESTION_KEY_RE,
  option: /^o_[a-z0-9]{8}$/,
  row: /^r_[a-z0-9]{8}$/,
  column: /^c_[a-z0-9]{8}$/,
  ending: /^e_[a-z0-9]{8}$/,
  logic: /^l_[a-z0-9]{8}$/,
}

export function isQuestionKey(value: unknown): value is string {
  return typeof value === 'string' && QUESTION_KEY_RE.test(value)
}

export function isOptionId(value: unknown): value is string {
  return typeof value === 'string' && ID_RES.option.test(value)
}

export function isId(kind: IdKind, value: unknown): value is string {
  return typeof value === 'string' && ID_RES[kind].test(value)
}

export interface IdGenerator {
  next(kind: IdKind): string
  questionKey(): string
  optionId(): string
  /** Generates an id of `kind` that is not in `taken`. */
  unique(kind: IdKind, taken: Iterable<string>): string
}

function cryptoSource(): () => number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is unavailable; pass a seed')
  const buf = new Uint32Array(64)
  let i = buf.length
  return () => {
    if (i >= buf.length) {
      c.getRandomValues!(buf)
      i = 0
    }
    return (buf[i++] as number) / 4294967296
  }
}

/**
 * With a seed the sequence is deterministic (tests, fixtures). Without one it
 * uses `crypto.getRandomValues`, present in browsers and Node 22.
 */
export function createIdGenerator(seed?: string | number): IdGenerator {
  const rand = seed === undefined ? cryptoSource() : mulberry32(typeof seed === 'number' ? seed : hashString(seed))
  const body = () => {
    let s = ''
    for (let i = 0; i < BODY_LENGTH; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)]
    return s
  }
  const next = (kind: IdKind) => ID_PREFIXES[kind] + body()
  return {
    next,
    questionKey: () => next('question'),
    optionId: () => next('option'),
    unique(kind, taken) {
      const set = new Set(taken)
      for (;;) {
        const id = next(kind)
        if (!set.has(id)) return id
      }
    },
  }
}

let defaultGen: IdGenerator | null = null
function gen(): IdGenerator {
  defaultGen ??= createIdGenerator()
  return defaultGen
}

export function generateId(kind: IdKind): string {
  return gen().next(kind)
}
export function generateQuestionKey(): string {
  return gen().questionKey()
}
export function generateOptionId(): string {
  return gen().optionId()
}

/** Seed stored in `responses.metadata.random_seed` (doc 03 section 3). 16 chars of `[a-z0-9]`. */
export function generateResponseSeed(seed?: string | number): string {
  const g = createIdGenerator(seed)
  return (g.next('logic') + g.next('logic')).replace(/l_/g, '')
}
