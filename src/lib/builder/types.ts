/** Shapes shared by the builder server actions and client components. Types only. */

import type { DiffResult, LintIssue } from '@/lib/survey'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export interface LockInfo {
  ok: boolean
  revision: number
  lockedBy: string | null
  lockedByName: string | null
  lockedAt: string | null
}

export interface DraftSnapshot {
  versionId: string
  revision: number
  definition: unknown
}

export type PublishOutcome =
  | { status: 'published'; newDraftVersionId: string; revision: number; versionNo: number | null }
  | { status: 'lint_failed'; issues: LintIssue[] }
  | { status: 'needs_ack'; diff: DiffResult }
