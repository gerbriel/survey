import { matrixAxes, questionOptions, ratingScale } from './aggregate'
import type { QuestionSnapshot } from './types'

/**
 * Cross-version comparison (doc 04 section 4.4). Answers group by
 * question_key; each widget compares the snapshots of the versions in scope.
 * Pure.
 */

export type VersionSnapshot = { versionId: string; versionNo: number; questions: QuestionSnapshot[] }

export type VersionDiff = {
  question_key: string
  /** The type changed: the widget refuses to combine and asks for one version. */
  typeChanged: boolean
  messages: string[]
  /** Option id to the version ids that offered it, for the per-option base. */
  offeredBy: Record<string, string[]>
  /** Latest labels first, then options only older versions had. */
  options: { id: string; label: string }[]
}

function setDiff(a: { id: string; label: string }[], b: { id: string; label: string }[]) {
  const ids = new Set(a.map((x) => x.id))
  return b.filter((x) => !ids.has(x.id))
}

function quote(labels: { label: string }[]): string {
  return labels.map((l) => `'${l.label}'`).join(', ')
}

/**
 * Compare one question across versions, oldest to newest. Returns null when
 * the key appears in fewer than two versions or nothing differs.
 */
export function compareQuestion(key: string, versions: VersionSnapshot[]): VersionDiff | null {
  const seen = [...versions]
    .sort((a, b) => a.versionNo - b.versionNo)
    .map((v) => ({ v, q: v.questions.find((q) => q.question_key === key) }))
    .filter((x): x is { v: VersionSnapshot; q: QuestionSnapshot } => Boolean(x.q))
  if (seen.length < 2) return null
  const messages: string[] = []
  let typeChanged = false
  const offeredBy: Record<string, string[]> = {}
  const latest = seen[seen.length - 1]!
  const options: { id: string; label: string }[] = [...questionOptions(latest.q)]
  for (const { v, q } of seen) for (const o of questionOptions(q)) (offeredBy[o.id] ??= []).push(v.versionId)
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1]!
    const cur = seen[i]!
    const span = `v${prev.v.versionNo} and v${cur.v.versionNo}`
    if (prev.q.type !== cur.q.type) {
      typeChanged = true
      messages.push(`Question type changed between ${span}: ${prev.q.type} to ${cur.q.type}.`)
      continue
    }
    const po = questionOptions(prev.q)
    const co = questionOptions(cur.q)
    const added = setDiff(po, co)
    const removed = setDiff(co, po)
    if (added.length || removed.length) {
      const parts = []
      if (added.length) parts.push(`${quote(added)} added in v${cur.v.versionNo}`)
      if (removed.length) parts.push(`${quote(removed)} removed in v${cur.v.versionNo}`)
      messages.push(`Options changed between ${span}: ${parts.join('; ')}.`)
    }
    if (cur.q.type === 'matrix') {
      const pa = matrixAxes(prev.q)
      const ca = matrixAxes(cur.q)
      if (setDiff(pa.rows, ca.rows).length || setDiff(ca.rows, pa.rows).length) messages.push(`Matrix rows changed between ${span}.`)
      if (setDiff(pa.columns, ca.columns).length || setDiff(ca.columns, pa.columns).length) {
        messages.push(`Matrix columns changed between ${span}.`)
      }
    }
    if (cur.q.type === 'rating') {
      const ps = ratingScale(prev.q)
      const cs = ratingScale(cur.q)
      if (ps.max !== cs.max) messages.push(`Scale changed between ${span}: 1 to ${ps.max} became 1 to ${cs.max}.`)
    }
  }
  for (const { q } of [...seen].reverse()) {
    for (const o of questionOptions(q)) if (!options.some((x) => x.id === o.id)) options.push(o)
  }
  if (messages.length === 0) return null
  // Options offered by every version need no per-option base.
  const all = seen.map((s) => s.v.versionId)
  for (const id of Object.keys(offeredBy)) if (offeredBy[id]!.length === all.length) delete offeredBy[id]
  return { question_key: key, typeChanged, messages, offeredBy, options }
}

export function compareVersions(versions: VersionSnapshot[]): Map<string, VersionDiff> {
  const keys = new Set(versions.flatMap((v) => v.questions.map((q) => q.question_key)))
  const out = new Map<string, VersionDiff>()
  for (const k of keys) {
    const d = compareQuestion(k, versions)
    if (d) out.set(k, d)
  }
  return out
}
