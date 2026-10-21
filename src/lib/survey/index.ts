/** Public API of the survey core (Phase 1B). Framework free: safe in the browser and in route handlers. */

export * from './types'
export {
  createIdGenerator,
  generateId,
  generateOptionId,
  generateQuestionKey,
  generateResponseSeed,
  ID_PREFIXES,
  isId,
  isOptionId,
  isQuestionKey,
  QUESTION_KEY_RE,
  type IdGenerator,
  type IdKind,
} from './ids'
export { hashString, mulberry32, rngFor, shuffleWithPins } from './random'
export { isSafeRegex, MAX_REGEX_LENGTH } from './regex'
export { DefinitionShapeError, checkDefinitionShape, migrateDefinition, safeMigrateDefinition } from './migrate'
export { choiceIds, normalizeAnswer, otherText, toE164, type Normalized } from './normalize'
export { conditionDepth, scoredCalcIds } from './definition'
export {
  calcOrder,
  compareLeaf,
  evaluate,
  evaluateCondition,
  evaluateNormalized,
  isAnswered,
  isCorrect,
  MAX_CONDITION_DEPTH,
  MAX_EVAL_PASSES,
  maxScore,
  normalizeAnswers,
  numericValue,
  operatorsFor,
  operatorsForField,
  orderMatrixRows,
  orderOptions,
  orderPageQuestions,
  orderPages,
  questionMaxScore,
  questionScore,
  resolveHidden,
  type EvalContext,
  type EvalState,
} from './engine'
export { formatAnswer, formatCalc, isPipeableType, parsePipeTokens, pipeText, resolvePipes, type PipeOptions, type PipeSegment, type PipeToken } from './pipe'
export {
  ERROR_MESSAGES,
  errorMessage,
  matchesMask,
  resolveDateBound,
  toAnswerRow,
  validateSubmission,
  type AnswerRow,
  type ErrorCode,
  type ValidateResult,
  type ValidationContext,
  type ValidationError,
} from './validate'
export { containsServerOnlyKeys, emptyServerOnly, findServerOnlyKeys, SERVER_ONLY_KEYS, splitDefinition, type ServerOnlyKey } from './split'
export {
  calcCycles,
  diffDefinitions,
  lintDefinition,
  MAX_DEFINITION_BYTES,
  MAX_QUESTIONS,
  type Change,
  type ChangeClass,
  type ChangeKind,
  type DiffResult,
  type LintCode,
  type LintIssue,
  type LintOptions,
  type LintResult,
  type LintSeverity,
} from './lint'
