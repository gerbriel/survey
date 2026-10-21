import type { ChoiceOption, Question, SurveyDefinition } from '@/lib/survey'
import type { ImportedQuestion } from '@/lib/builder/importText'
import { addPage, addQuestion, newChildId } from '@/lib/builder/ops'
import { CHOICE_TYPES, newQuestion } from './model'

function toQuestion(item: ImportedQuestion, def: SurveyDefinition): Question {
  const q = newQuestion(item.type, def, item.label)
  q.required = item.required
  if (CHOICE_TYPES.has(item.type) && item.options.length) {
    const options: ChoiceOption[] = []
    for (const label of item.options) options.push({ id: newChildId('option', options), label })
    ;(q.settings as { options: ChoiceOption[] }).options = options
  }
  return q
}

/**
 * Append imported questions. The first imported page fills `pageId` (or the
 * last page); every later `---` page becomes a new page after it.
 */
export function applyImport(def: SurveyDefinition, pages: ImportedQuestion[][], pageId?: string): { definition: SurveyDefinition; count: number } {
  let next = def
  let target = pageId ?? def.pages[def.pages.length - 1]?.id
  let count = 0
  pages.forEach((items, i) => {
    if (i > 0 || !target) {
      const at = next.pages.findIndex((p) => p.id === target)
      const r = addPage(next, at >= 0 ? at : undefined)
      next = r.definition
      target = r.pageId
    }
    for (const item of items) {
      next = addQuestion(next, toQuestion(item, next), target)
      count++
    }
  })
  return { definition: next, count }
}
