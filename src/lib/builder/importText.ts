/**
 * Plain-text import (doc 03 section 6, "Import from text").
 *
 * Syntax, one item per line:
 *   Question text            a question (type sniffed from the words)
 *   Question text *          trailing asterisk: required
 *   Question text [multi]    tags pick a type, see IMPORT_TAGS
 *   - Option  or  * Option   an option of the question above
 *   ---                      start a new page
 * Blank lines are ignored.
 *
 * Without options the label is sniffed: "email" becomes email, "phone"
 * becomes phone, "date" becomes date, "how likely" becomes NPS, else short
 * text. With options the default is single choice.
 */

import type { QuestionType } from '@/lib/survey'

export interface ImportedQuestion {
  label: string
  type: QuestionType
  required: boolean
  options: string[]
  /** 1-based source line, for the preview table. */
  line: number
}

export interface ImportResult {
  pages: ImportedQuestion[][]
  warnings: string[]
}

/**
 * Decision: besides doc 03's [multi] and [dropdown], a few more tags so the
 * paste box covers the common types without a second pass in the preview.
 */
export const IMPORT_TAGS: Record<string, QuestionType> = {
  multi: 'multiple_choice',
  dropdown: 'dropdown',
  single: 'single_choice',
  long: 'long_text',
  text: 'short_text',
  number: 'number',
  email: 'email',
  phone: 'phone',
  date: 'date',
  time: 'time',
  yesno: 'yes_no',
  rating: 'rating',
  nps: 'nps',
  ranking: 'ranking',
}

const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(['single_choice', 'multiple_choice', 'dropdown', 'ranking'])
const OPTION_RE = /^[-*]\s+(.*)$/
const PAGE_RE = /^-{3,}$/

export function sniffType(label: string): QuestionType {
  const l = label.toLowerCase()
  if (l.includes('email')) return 'email'
  if (l.includes('phone')) return 'phone'
  if (l.includes('how likely')) return 'nps'
  if (/\bdate\b/.test(l) || l.includes('date')) return 'date'
  return 'short_text'
}

/** Strip trailing tags and the required asterisk, in any order. */
function parseQuestionLine(raw: string): { label: string; tag: QuestionType | null; required: boolean; unknownTags: string[] } {
  let s = raw.trim()
  let tag: QuestionType | null = null
  let required = false
  const unknownTags: string[] = []
  for (;;) {
    const t = s.match(/\s*\[([a-z/ -]+)\]\s*$/i)
    if (t) {
      const name = (t[1] as string).toLowerCase().replace(/[\s/-]/g, '')
      const mapped = IMPORT_TAGS[name]
      if (mapped) tag = mapped
      else unknownTags.push(t[1] as string)
      s = s.slice(0, t.index).trimEnd()
      continue
    }
    if (s.length > 1 && s.endsWith('*')) {
      required = true
      s = s.slice(0, -1).trimEnd()
      continue
    }
    break
  }
  return { label: s, tag, required, unknownTags }
}

export function parseImportText(text: string): ImportResult {
  const pages: ImportedQuestion[][] = [[]]
  const warnings: string[] = []
  const tags = new Map<ImportedQuestion, QuestionType | null>()
  let current: ImportedQuestion | null = null
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim()
    const n = i + 1
    if (line === '') return
    if (PAGE_RE.test(line)) {
      if ((pages[pages.length - 1] as ImportedQuestion[]).length > 0) pages.push([])
      current = null
      return
    }
    const opt = line.match(OPTION_RE)
    if (opt) {
      const label = (opt[1] as string).trim()
      if (!current) {
        warnings.push(`Line ${n}: option "${label}" has no question above it and was skipped.`)
        return
      }
      if (label) (current as ImportedQuestion).options.push(label)
      return
    }
    const parsed = parseQuestionLine(line)
    if (!parsed.label) {
      warnings.push(`Line ${n}: empty question skipped.`)
      return
    }
    for (const t of parsed.unknownTags) warnings.push(`Line ${n}: unknown tag [${t}] ignored.`)
    const q: ImportedQuestion = { label: parsed.label, type: 'short_text', required: parsed.required, options: [], line: n }
    tags.set(q, parsed.tag)
    ;(pages[pages.length - 1] as ImportedQuestion[]).push(q)
    current = q
  })
  for (const page of pages) {
    for (const q of page) {
      const tag = tags.get(q) ?? null
      if (q.options.length > 0) {
        q.type = tag && CHOICE_TYPES.has(tag) ? tag : 'single_choice'
        if (tag && !CHOICE_TYPES.has(tag)) warnings.push(`Line ${q.line}: options given, so the question became single choice.`)
      } else if (tag) {
        q.type = tag
        if (CHOICE_TYPES.has(tag)) warnings.push(`Line ${q.line}: choice question without options; add options before publishing.`)
      } else {
        q.type = sniffType(q.label)
      }
    }
  }
  const nonEmpty = pages.filter((p) => p.length > 0)
  return { pages: nonEmpty, warnings }
}

export const IMPORT_HELP = [
  'One question per line.',
  'Lines starting with "- " or "* " under a question are its options (single choice by default).',
  'End a question with * to make it required.',
  'Tags at the end pick a type: [multi], [dropdown], [long], [number], [email], [phone], [date], [time], [yesno], [rating], [nps], [ranking].',
  'A line with only --- starts a new page.',
  'Without options or tags, labels mentioning email, phone or date get that type, and "how likely" becomes NPS.',
]
