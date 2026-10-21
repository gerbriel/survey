/** Public API of the survey renderer (Phase 1C). Client components and pure helpers, no data access. */

export { SurveyRenderer } from './SurveyRenderer'
export { SurveyShell, logoSrc } from './SurveyShell'
export { PageView } from './PageView'
export { QuestionBlock, QuestionFrame, type QuestionIds } from './QuestionFrame'
export { ThemeProvider } from './ThemeProvider'
export { Progress } from './Progress'
export { PreviewBanner, PreviewTools } from './PreviewTools'
export {
  ClosedScreen,
  ThankYouScreen,
  endingRedirect,
  endingView,
  safeRedirect,
  scoreOverrides,
  summarizeAnswers,
  type SummaryItem,
} from './Endings'
export { registry, isAnswerable } from './registry'
export { RichTextView, parseMdLite, richTextPlain, safeHref } from './richtext'
export { contrastRatio, ensureContrast, fontStack, readableOn, themeToCssVars } from './theme'
export { DEFAULT_STRINGS, fmt, mergeStrings, type RendererStrings } from './strings'
export {
  isRenderable,
  nextPageId,
  screenQuestionIds,
  surveyReducer,
  useSurveyState,
  type NextResult,
  type SurveyAction,
  type SurveyState,
  type SurveyStateApi,
} from './useSurveyState'
export { AUTOSAVE_DEBOUNCE_MS, useAutosave } from './useAutosave'
export type {
  AutosaveSnapshot,
  EndingInfo,
  FrameKind,
  InputContext,
  InputProps,
  PendingUpload,
  PublicDefinition,
  RendererEvent,
  RendererMode,
  SubmitMeta,
  SubmitOutcome,
  SurveyRendererProps,
  TypeEntry,
  TypeRegistry,
  UploadsApi,
} from './types'
