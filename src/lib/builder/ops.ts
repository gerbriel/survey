/**
 * Pure definition edits for the builder (doc 03 section 6). Every function
 * returns a new definition and leaves the input untouched, so the undo
 * history can keep plain snapshots.
 */

import {
  createIdGenerator,
  STORAGE_COLUMN,
  type Ending,
  type IdGenerator,
  type IdKind,
  type LogicRule,
  type Page,
  type Question,
  type QuestionType,
  type SurveyDefinition,
} from '@/lib/survey'

let gen: IdGenerator | null = null
function ids(): IdGenerator {
  gen ??= createIdGenerator()
  return gen
}

/** Tests pass a seeded generator for deterministic ids. */
export function setIdGenerator(g: IdGenerator | null) {
  gen = g
}

export function takenIds(def: SurveyDefinition): Set<string> {
  const s = new Set<string>()
  for (const q of Object.values(def.questions)) {
    s.add(q.id)
    s.add(q.question_key)
  }
  def.pages.forEach((p) => s.add(p.id))
  def.endings.forEach((e) => s.add(e.id))
  def.logic.forEach((r) => s.add(r.id))
  return s
}

export function newId(def: SurveyDefinition, kind: IdKind, extra: Iterable<string> = []): string {
  const taken = takenIds(def)
  for (const x of extra) taken.add(x)
  return ids().unique(kind, taken)
}

/** Option, row and column ids are scoped per question; uniqueness within the list is enough. */
export function newChildId(kind: 'option' | 'row' | 'column', existing: { id: string }[]): string {
  return ids().unique(kind, existing.map((x) => x.id))
}

export function pageOf(def: SurveyDefinition, questionId: string): { page: Page; pageIndex: number; index: number } | null {
  for (let i = 0; i < def.pages.length; i++) {
    const page = def.pages[i] as Page
    const index = page.question_ids.indexOf(questionId)
    if (index >= 0) return { page, pageIndex: i, index }
  }
  return null
}

function withPages(def: SurveyDefinition, pages: Page[]): SurveyDefinition {
  return { ...def, pages }
}

export function addQuestion(def: SurveyDefinition, q: Question, pageId?: string, index?: number): SurveyDefinition {
  const target = pageId ?? def.pages[def.pages.length - 1]?.id
  let pages = def.pages
  if (!target) {
    pages = [{ id: newId(def, 'page'), question_ids: [] }]
  }
  const pid = target ?? (pages[0] as Page).id
  // Owner feedback 2026-10-22: the first email (or phone) question becomes the
  // identity key on its own, so contacts match without finding a checkbox.
  const identity = { ...def.identity }
  if (q.type === 'email' && identity.email_question_id === undefined) identity.email_question_id = q.id
  if (q.type === 'phone' && identity.phone_question_id === undefined) identity.phone_question_id = q.id
  return {
    ...def,
    identity,
    questions: { ...def.questions, [q.id]: q },
    pages: pages.map((p) => {
      if (p.id !== pid) return p
      const list = [...p.question_ids]
      const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
      list.splice(at, 0, q.id)
      return { ...p, question_ids: list }
    }),
  }
}

/** Rules that point at the question as their target go with it; rules that only read it stay and lint flags them. */
export function removeQuestion(def: SurveyDefinition, id: string): SurveyDefinition {
  const questions = { ...def.questions }
  delete questions[id]
  const identity = { ...def.identity }
  if (identity.email_question_id === id) delete identity.email_question_id
  if (identity.phone_question_id === id) delete identity.phone_question_id
  const settings = { ...def.settings }
  if (settings.quiz?.score_calc_id === id) delete settings.quiz
  return {
    ...def,
    settings,
    identity,
    questions,
    pages: def.pages.map((p) => ({
      ...p,
      question_ids: p.question_ids.filter((x) => x !== id),
      ...(p.randomize_questions ? { randomize_questions: { pinned_ids: p.randomize_questions.pinned_ids.filter((x) => x !== id) } } : {}),
    })),
    logic: def.logic.filter((r) => !((r.kind === 'show_question' || r.kind === 'hide_question') && r.target_id === id)),
  }
}

export function updateQuestion(def: SurveyDefinition, id: string, fn: (q: Question) => Question): SurveyDefinition {
  const q = def.questions[id]
  if (!q) return def
  return { ...def, questions: { ...def.questions, [id]: fn(q) } }
}

/** Move a question to `toIndex` on page `toPageId` (index counted after removal). */
export function moveQuestion(def: SurveyDefinition, id: string, toPageId: string, toIndex: number): SurveyDefinition {
  if (!def.pages.some((p) => p.id === toPageId)) return def
  const stripped = def.pages.map((p) => ({ ...p, question_ids: p.question_ids.filter((x) => x !== id) }))
  return withPages(
    def,
    stripped.map((p) => {
      if (p.id !== toPageId) return p
      const list = [...p.question_ids]
      list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, id)
      return { ...p, question_ids: list }
    }),
  )
}

/**
 * Keyboard reorder: one step up or down. At a page edge the question crosses
 * into the neighboring page (last slot when moving up, first when moving down).
 */
export function moveQuestionBy(def: SurveyDefinition, id: string, delta: -1 | 1): SurveyDefinition {
  const at = pageOf(def, id)
  if (!at) return def
  const { page, pageIndex, index } = at
  const next = index + delta
  if (next >= 0 && next < page.question_ids.length) return moveQuestion(def, id, page.id, next)
  const neighbor = def.pages[pageIndex + delta]
  if (!neighbor) return def
  return moveQuestion(def, id, neighbor.id, delta < 0 ? neighbor.question_ids.length : 0)
}

export function addPage(def: SurveyDefinition, afterIndex?: number): { definition: SurveyDefinition; pageId: string } {
  const pageId = newId(def, 'page')
  const pages = [...def.pages]
  const at = afterIndex === undefined ? pages.length : afterIndex + 1
  pages.splice(at, 0, { id: pageId, question_ids: [] })
  return { definition: withPages(def, pages), pageId }
}

/**
 * Decision: removing a page keeps its questions by moving them to the
 * previous page (or the next one when it is the first). The last page cannot
 * be removed. Logic rules that target the page go with it.
 */
export function removePage(def: SurveyDefinition, pageId: string): SurveyDefinition {
  if (def.pages.length <= 1) return def
  const i = def.pages.findIndex((p) => p.id === pageId)
  if (i < 0) return def
  const page = def.pages[i] as Page
  const into = i > 0 ? i - 1 : 1
  const pages = def.pages
    .map((p, j) => (j === into ? { ...p, question_ids: into < i ? [...p.question_ids, ...page.question_ids] : [...page.question_ids, ...p.question_ids] } : p))
    .filter((p) => p.id !== pageId)
  const logic = def.logic.filter((r) => {
    if (r.kind === 'show_page') return r.target_id !== pageId
    if (r.kind === 'jump') return r.from_page_id !== pageId && !('page_id' in r.to && r.to.page_id === pageId)
    return true
  })
  const settings = { ...def.settings }
  if (settings.randomize_pages) settings.randomize_pages = { page_ids: settings.randomize_pages.page_ids.filter((x) => x !== pageId) }
  return { ...def, pages, logic, settings }
}

export function movePage(def: SurveyDefinition, from: number, to: number): SurveyDefinition {
  if (from === to || from < 0 || to < 0 || from >= def.pages.length || to >= def.pages.length) return def
  const pages = [...def.pages]
  const [p] = pages.splice(from, 1)
  pages.splice(to, 0, p as Page)
  return withPages(def, pages)
}

export function updatePage(def: SurveyDefinition, pageId: string, patch: Partial<Page>): SurveyDefinition {
  return withPages(
    def,
    def.pages.map((p) => (p.id === pageId ? stripUndefined({ ...p, ...patch }) : p)),
  )
}

/**
 * Duplicate (doc 03 section 6): new id and key, options keep their ids,
 * logic targeting the original is not copied. Decision: keys follow the
 * q_ + 8 format (doc 01), so the `_2` suffix rule becomes a fresh key.
 */
export function duplicateQuestion(def: SurveyDefinition, id: string): { definition: SurveyDefinition; id: string } {
  const q = def.questions[id]
  const at = pageOf(def, id)
  if (!q || !at) return { definition: def, id }
  const nid = newId(def, 'question')
  const copy = { ...structuredClone(q), id: nid, question_key: nid } as Question
  return { definition: addQuestion(def, copy, at.page.id, at.index + 1), id: nid }
}

/**
 * Change a question's type. Label, help, required and pii carry over; type
 * settings come from `settings`. When the storage column changes and the key
 * appears in a published version, the builder assigns a new key (doc 03
 * section 7, "forced new key").
 */
export function changeType(
  def: SurveyDefinition,
  id: string,
  type: QuestionType,
  settings: unknown,
  publishedKeys: ReadonlySet<string>,
): SurveyDefinition {
  const q = def.questions[id]
  if (!q || q.type === type) return def
  const crosses = STORAGE_COLUMN[q.type] !== STORAGE_COLUMN[type]
  const key = crosses && publishedKeys.has(q.question_key) ? newId(def, 'question') : q.question_key
  const next = stripUndefined({
    id: q.id,
    question_key: key,
    type,
    label: q.label,
    help: q.help,
    required: q.required,
    pii: q.pii,
    settings,
  }) as unknown as Question
  const identity = { ...def.identity }
  if (identity.email_question_id === id && type !== 'email') delete identity.email_question_id
  if (identity.phone_question_id === id && type !== 'phone') delete identity.phone_question_id
  // Same auto-assignment when a question is changed into an email or phone question.
  if (type === 'email' && identity.email_question_id === undefined) identity.email_question_id = id
  if (type === 'phone' && identity.phone_question_id === undefined) identity.phone_question_id = id
  return { ...def, identity, questions: { ...def.questions, [id]: next } }
}

export function addEnding(def: SurveyDefinition): { definition: SurveyDefinition; id: string } {
  const id = newId(def, 'ending')
  const ending: Ending = { id, message: { format: 'md-lite', text: 'Thank you for your response.' }, show_score: false, show_summary: false }
  return { definition: { ...def, endings: [...def.endings, ending] }, id }
}

export function updateEnding(def: SurveyDefinition, id: string, patch: Partial<Ending>): SurveyDefinition {
  return { ...def, endings: def.endings.map((e) => (e.id === id ? stripUndefined({ ...e, ...patch }) : e)) }
}

/** Rules that send respondents to the ending go with it. The last ending cannot be removed. */
export function removeEnding(def: SurveyDefinition, id: string): SurveyDefinition {
  if (def.endings.length <= 1) return def
  return {
    ...def,
    endings: def.endings.filter((e) => e.id !== id),
    logic: def.logic.filter((r) => {
      if (r.kind === 'set_ending') return r.ending_id !== id
      if (r.kind === 'jump') return !('ending_id' in r.to && r.to.ending_id === id)
      return true
    }),
  }
}

export function upsertRule(def: SurveyDefinition, rule: LogicRule): SurveyDefinition {
  const exists = def.logic.some((r) => r.id === rule.id)
  return { ...def, logic: exists ? def.logic.map((r) => (r.id === rule.id ? rule : r)) : [...def.logic, rule] }
}

export function removeRule(def: SurveyDefinition, id: string): SurveyDefinition {
  return { ...def, logic: def.logic.filter((r) => r.id !== id) }
}

/** Questions on pages before `pageId`, in order (field pickers offer only earlier questions). */
export function questionsBefore(def: SurveyDefinition, pageId: string, includeSamePageBefore?: string): Question[] {
  const out: Question[] = []
  for (const p of def.pages) {
    if (p.id === pageId) {
      if (includeSamePageBefore) {
        for (const id of p.question_ids) {
          if (id === includeSamePageBefore) break
          const q = def.questions[id]
          if (q) out.push(q)
        }
      }
      break
    }
    for (const id of p.question_ids) {
      const q = def.questions[id]
      if (q) out.push(q)
    }
  }
  return out
}

/** Every question in page order (orphans last). */
export function orderedQuestions(def: SurveyDefinition): Question[] {
  const seen = new Set<string>()
  const out: Question[] = []
  for (const p of def.pages) {
    for (const id of p.question_ids) {
      const q = def.questions[id]
      if (q && !seen.has(id)) {
        seen.add(id)
        out.push(q)
      }
    }
  }
  for (const q of Object.values(def.questions)) if (!seen.has(q.id)) out.push(q)
  return out
}

/** JSON has no undefined: drop keys set to undefined so the stored definition stays pure. */
export function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as T
}
