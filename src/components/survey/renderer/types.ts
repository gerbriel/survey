/**
 * Renderer contracts (doc 03 section 5). Phase 2B (builder preview) and 2C
 * (public page) talk to the renderer only through these types.
 */

import type { ComponentType, ReactNode } from 'react'
import type {
  AnswerValue,
  Ending,
  EvalState,
  FileRef,
  QuestionOf,
  QuestionType,
  SurveyDefinition,
  Theme,
  ValidationError,
} from '@/lib/survey'
import type { RendererStrings } from './strings'

/**
 * The browser-safe half of a published version (`splitDefinition(...).public_definition`).
 * Same shape as SurveyDefinition with server-only fields removed.
 */
export type PublicDefinition = SurveyDefinition

export type RendererMode = 'live' | 'preview'

/** What useAutosave sends. Answers are keyed by question_key (wire format). */
export interface AutosaveSnapshot {
  answers: Record<string, unknown>
  page_id: string
  seed: string
}

export interface SubmitMeta {
  /** Ending the browser engine picked. The server may override it when scoring decides. */
  ending_id: string | null
  ended_early: boolean
  /** Last page shown. */
  page_id: string
  path: string[]
  seed: string
  /** Unscored calculated values keyed by question_key. Informational; the server recomputes. */
  computed: Record<string, number>
}

/**
 * What onSubmit resolves with. `score` and `ending_id` come from the submit
 * result (doc 02 section 5.4); scores are never computed in the browser.
 */
export type SubmitOutcome =
  | { ok: true; score?: { value: number; max: number } | null; ending_id?: string | null }
  | { ok: false; message?: string; fieldErrors?: Record<string, string> }

/**
 * First-party event vocabulary (doc 01 events, doc 04 section 3.2). `view`,
 * `abandon` and `file_upload` belong to the page (Phase 2E), not the renderer.
 * Events never carry answer values.
 */
export type RendererEvent =
  | { type: 'start' }
  | { type: 'question_view'; question_key: string; meta: { page: string; position: number } }
  | { type: 'question_answer'; question_key: string; meta: { page: string } }
  | { type: 'page_next'; meta: { from_page: string; to_page: string } }
  | { type: 'page_back'; meta: { from_page: string; to_page: string } }
  | { type: 'complete'; meta: { ending_id: string | null } }

/** A file the caller is uploading for a question (presentational only). */
export interface PendingUpload {
  id: string
  name: string
  /** 0 to 100 when known. */
  progress?: number
  error?: string
}

/**
 * Upload transport lives in Phase 2C (doc 02 section 6). The renderer only
 * hands over File objects and shows what the caller reports.
 */
export interface UploadsApi {
  /** Mint, upload and resolve the stored FileRef, or null when the caller rejected it. */
  request: (question_key: string, file: File) => Promise<FileRef | null>
  remove: (question_key: string, ref: FileRef) => Promise<void> | void
  /** Upload manifest keyed by question_key; passed to the validator as `context.files`. */
  files: Record<string, FileRef[]>
  pending?: Record<string, PendingUpload[]>
}

export interface EndingInfo {
  ending: Ending
  /** Piped, URL-encoded and https checked; null when absent or unsafe. The caller redirects. */
  redirect_url: string | null
  redirect_delay_seconds: number
  score: { value: number; max: number } | null
}

export interface SurveyRendererProps {
  definition: PublicDefinition
  mode: RendererMode
  /** responses.metadata.random_seed; drives every shuffle. */
  seed: string
  /** Resume: wire answers keyed by question_key. */
  initialAnswers?: Record<string, unknown>
  /** Resume: page to open on. Ignored when not on the current path. */
  initialPageId?: string
  /** Hidden field values captured from the URL by the caller. */
  hidden?: Record<string, string>
  /** ISO timestamp for relative date bounds. Defaults to the clock at mount. */
  now?: string
  /** Live only. Fire and forget: retry with backoff is the caller's job. */
  onAutosave?: (snapshot: AutosaveSnapshot) => Promise<void> | void
  /** Live only, never called in preview. */
  onSubmit: (cleaned: Record<string, AnswerValue>, visible_keys: string[], meta: SubmitMeta) => Promise<SubmitOutcome>
  onEvent?: (event: RendererEvent) => void
  /** Called once the ending screen shows; the caller performs any redirect. */
  onEnding?: (info: EndingInfo) => void
  /** Fires when a consent block with gates_tracking changes (00 R7, in_form mode). */
  onTrackingConsent?: (granted: boolean, question_key: string) => void
  uploads?: UploadsApi
  /** Replaces definition.theme (builder live theme editing). */
  theme?: Theme
  strings?: Partial<RendererStrings>
  /** Workspace logo URL for `theme.logo.source = 'workspace'`. */
  logoUrl?: string
  /** Storage path to a public URL for logo, cover, background, image blocks and option images. */
  resolveAssetUrl?: (path: string) => string | null
  /** next/font class names from the safe list, loaded by the page. */
  fontClassName?: string
  /** Phase 2C injects Powered by, privacy and report links here. */
  footer?: ReactNode
}

/** Everything an Input may need beyond its own value. */
export interface InputContext {
  definition: PublicDefinition
  state: EvalState
  seed: string
  mode: RendererMode
  now: string
  strings: RendererStrings
  uploads?: UploadsApi
  resolveAssetUrl?: (path: string) => string | null
  onTrackingConsent?: (granted: boolean, question_key: string) => void
}

export interface InputProps<Q = QuestionOf<QuestionType>> {
  question: Q
  /** Raw client value in a shape normalizeAnswer accepts. */
  value: unknown
  onChange: (value: unknown) => void
  errors: ValidationError[]
  /** id for the primary control. */
  inputId: string
  /** id of the visible question label (legend). */
  labelId: string
  /** Help and error ids, already joined. */
  describedBy: string | undefined
  invalid: boolean
  ctx: InputContext
}

/**
 * fieldset: question with a legend. block: labelled display item (statement,
 * image, calculated). none: renders nothing visible (hidden).
 */
export type FrameKind = 'fieldset' | 'block' | 'none'

export interface TypeEntry<T extends QuestionType> {
  Input: ComponentType<InputProps<QuestionOf<T>>>
  defaultSettings: QuestionOf<T>['settings']
  emptyValue: unknown
  /** Read-only text for the ending summary. */
  summarize?: (question: QuestionOf<T>, value: AnswerValue) => string
  frame: FrameKind
}

export type TypeRegistry = { [T in QuestionType]: TypeEntry<T> }
