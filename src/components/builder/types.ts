import type { SurveyDefinition } from '@/lib/survey'

export type Selection =
  | { kind: 'survey' }
  | { kind: 'question'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'ending'; id: string }

/** Commit an edit. Edits with the same key within one second coalesce into one undo step. */
export type Commit = (next: SurveyDefinition, key?: string) => void
