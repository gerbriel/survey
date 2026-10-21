/**
 * One error contract for every wrapper in src/lib/db.
 *
 * SQL functions raise their error code as the exception message
 * (`raise exception 'revision_conflict'`), sometimes followed by a colon and a
 * detail (`server_only_key_in_public_definition: score`). PostgREST hands that
 * back as `{ message, code: 'P0001', details, hint }`. `toDbError` turns it,
 * or any other failure, into a `DbError` the UI can switch on:
 *
 *   switch (result.error.code) { case 'revision_conflict': ... }
 *
 * The code list below is every code raised by supabase/migrations 0001 to
 * 0017. When a migration adds a code, add it here and to the tests.
 */

/** Codes raised with `raise exception '<code>[: detail]'` in the migrations. */
export const SQL_ERROR_CODES = [
  // auth and membership
  'not_authenticated',
  'not_authorized',
  // workspaces, lifecycle, admin (0003)
  'invalid_name',
  'slug_taken',
  'invalid_owner',
  'invalid_request_id',
  'not_found',
  'invalid_target',
  'target_not_member',
  'invalid_state',
  'confirm_slug_mismatch',
  'note_required',
  'invalid_limits',
  'unknown_limit',
  // surveys and drafts (0005)
  'template_not_found',
  'alias_reserved',
  'alias_invalid',
  'alias_taken',
  'not_draft',
  'lock_lost',
  'lock_held',
  'revision_conflict',
  'invalid_definition',
  'definition_too_large',
  'too_many_questions',
  // publish (0006)
  'invalid_question_key',
  'duplicate_question_key',
  'unknown_question_type',
  'invalid_option_id',
  'duplicate_option_id',
  'invalid_identity',
  'key_type_conflict',
  'invalid_public_definition',
  'server_only_key_in_public_definition',
  'reason_required',
  // contacts and privacy (0007, 0014)
  'invalid_custom_field',
  'contact_read_only',
  'import_finished',
  'invalid_rows',
  'merge_size',
  'invalid_contacts',
  'invalid_mode',
  // pixels, events, submission, jobs (0009, 0010, 0012, 0015)
  'raw_script_pixels_disabled',
  'too_many_events',
  'invalid_rate_limit_arguments',
  'not_due',
] as const

export type SqlErrorCode = (typeof SQL_ERROR_CODES)[number]

/** Codes produced on the TypeScript side or from Postgres and PostgREST states. */
export const CLIENT_ERROR_CODES = [
  'invalid_input', // zod rejected the wrapper input before any network call
  'guard_violation', // a trigger refused the write (message is an English sentence)
  'permission_denied', // SQLSTATE 42501: no grant, or RLS refused the row
  'unique_violation', // 23505
  'foreign_key_violation', // 23503
  'check_violation', // 23514, 23502
  'invalid_value', // 22P02 and other data exceptions
  'no_rows', // PGRST116: .single() found nothing
  'session_expired', // PGRST301, PGRST303: JWT missing or expired
  'function_not_found', // PGRST202: schema cache has no such function
  'network', // fetch failed
  'unknown',
] as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number]
export type DbErrorCode = SqlErrorCode | ClientErrorCode

/**
 * Coarse grouping of codes, mirroring the build plan's `auth.*`, `lock.*`,
 * `survey.*`, `limit.*` prefixes. The SQL itself uses flat codes.
 */
export type DbErrorCategory = 'auth' | 'lock' | 'survey' | 'limit' | 'input' | 'conflict' | 'system'

export type DbError = {
  code: DbErrorCode
  /** Text after the colon in `code: detail`, or the zod issue summary. */
  detail?: string
  /** Plain-language sentence safe to show a member. */
  message: string
  category: DbErrorCategory
  /** SQLSTATE or PostgREST code, for logs. */
  sqlState?: string
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: DbError }

const SQL_CODES = new Set<string>(SQL_ERROR_CODES)

const MESSAGES: Record<DbErrorCode, string> = {
  not_authenticated: 'Your session has ended. Sign in again.',
  not_authorized: 'You do not have permission to do that.',
  invalid_name: 'Enter a name between 1 and 80 characters.',
  slug_taken: 'That address is already taken. Pick another.',
  invalid_owner: 'That person cannot own a workspace.',
  invalid_request_id: 'That request was already handled.',
  not_found: 'We could not find that. It may have been deleted.',
  invalid_target: 'Pick a different member.',
  target_not_member: 'The new owner must already be an active member.',
  invalid_state: 'That action is not available in the current state.',
  confirm_slug_mismatch: 'The confirmation text does not match the workspace address.',
  note_required: 'Add a note explaining the change.',
  invalid_limits: 'Those limits are not valid.',
  unknown_limit: 'One of those limits does not exist.',
  template_not_found: 'That template is not available.',
  alias_reserved: 'That link name is reserved. Pick another.',
  alias_invalid: 'Use 3 to 60 lowercase letters, numbers and single hyphens.',
  alias_taken: 'That link name is already in use.',
  not_draft: 'This version is already published.',
  lock_lost: 'Someone else is editing this survey now. Your latest change was not saved.',
  lock_held: 'Someone else is editing this survey.',
  revision_conflict: 'This survey changed since you opened it. Reload to get the latest version.',
  invalid_definition: 'The survey has a problem that blocks saving.',
  definition_too_large: 'The survey is too large to save.',
  too_many_questions: 'The survey has more questions than allowed.',
  invalid_question_key: 'A question has an invalid key.',
  duplicate_question_key: 'Two questions share the same key.',
  unknown_question_type: 'A question has an unknown type.',
  invalid_option_id: 'A choice option is missing its id.',
  duplicate_option_id: 'Two choice options share the same id.',
  invalid_identity: 'The identity question must be an email or phone question.',
  key_type_conflict: 'A question changed type in a way that breaks earlier responses.',
  invalid_public_definition: 'The published survey could not be prepared.',
  server_only_key_in_public_definition: 'The published survey still contains scoring data.',
  reason_required: 'Add a reason.',
  invalid_custom_field: 'One of the custom field values is not valid.',
  contact_read_only: 'This contact was merged or erased and cannot change.',
  import_finished: 'This import has already finished.',
  invalid_rows: 'The import chunk is not valid.',
  merge_size: 'Pick 2 to 5 contacts to merge.',
  invalid_contacts: 'All contacts must be active and in this workspace.',
  invalid_mode: 'Pick hard delete or anonymize.',
  raw_script_pixels_disabled: 'Script pixels are turned off for this workspace.',
  too_many_events: 'Too many events in one batch.',
  invalid_rate_limit_arguments: 'Rate limit arguments are not valid.',
  not_due: 'This workspace cannot be purged yet.',
  invalid_input: 'Some of the information is not valid.',
  guard_violation: 'That change is not allowed.',
  permission_denied: 'You do not have permission to do that.',
  unique_violation: 'That already exists.',
  foreign_key_violation: 'That refers to something that no longer exists.',
  check_violation: 'One of the values is not allowed.',
  invalid_value: 'One of the values has the wrong format.',
  no_rows: 'We could not find that.',
  session_expired: 'Your session has ended. Sign in again.',
  function_not_found: 'The database is out of date. Contact a platform admin.',
  network: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
}

export function categoryOf(code: DbErrorCode): DbErrorCategory {
  switch (code) {
    case 'not_authenticated':
    case 'not_authorized':
    case 'permission_denied':
    case 'session_expired':
      return 'auth'
    case 'lock_lost':
    case 'lock_held':
      return 'lock'
    case 'revision_conflict':
    case 'slug_taken':
    case 'alias_taken':
    case 'unique_violation':
    case 'invalid_state':
    case 'not_draft':
    case 'import_finished':
      return 'conflict'
    case 'definition_too_large':
    case 'too_many_questions':
    case 'too_many_events':
    case 'invalid_limits':
    case 'unknown_limit':
    case 'raw_script_pixels_disabled':
      return 'limit'
    case 'invalid_definition':
    case 'invalid_question_key':
    case 'duplicate_question_key':
    case 'unknown_question_type':
    case 'invalid_option_id':
    case 'duplicate_option_id':
    case 'invalid_identity':
    case 'key_type_conflict':
    case 'invalid_public_definition':
    case 'server_only_key_in_public_definition':
    case 'template_not_found':
    case 'alias_reserved':
    case 'alias_invalid':
      return 'survey'
    case 'function_not_found':
    case 'network':
    case 'unknown':
    case 'guard_violation':
      return 'system'
    default:
      return 'input'
  }
}

export function makeDbError(code: DbErrorCode, detail?: string, sqlState?: string): DbError {
  const err: DbError = { code, message: MESSAGES[code], category: categoryOf(code) }
  if (detail !== undefined && detail !== '') err.detail = detail
  if (sqlState) err.sqlState = sqlState
  return err
}

/** Parses `code` or `code: detail` when code is a known SQL error code. */
export function parseSqlMessage(message: string): { code: SqlErrorCode; detail?: string } | null {
  const m = /^([a-z][a-z0-9_]*)(?::\s*([\s\S]*))?$/.exec(message.trim())
  if (!m || !m[1] || !SQL_CODES.has(m[1])) return null
  const detail = m[2]?.trim()
  return detail ? { code: m[1] as SqlErrorCode, detail } : { code: m[1] as SqlErrorCode }
}

type PostgrestLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; name?: unknown }

const SQLSTATE_MAP: Record<string, ClientErrorCode> = {
  '42501': 'permission_denied',
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23514': 'check_violation',
  '23502': 'check_violation',
  '22P02': 'invalid_value',
  '22007': 'invalid_value',
  '22008': 'invalid_value',
  '22003': 'invalid_value',
  '22023': 'invalid_value',
  PGRST116: 'no_rows',
  PGRST202: 'function_not_found',
  PGRST301: 'session_expired',
  PGRST302: 'session_expired',
  PGRST303: 'session_expired',
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/**
 * Maps anything a Supabase call can fail with to a DbError:
 * a PostgrestError, an AuthError, a thrown fetch TypeError, or an unknown value.
 */
export function toDbError(e: unknown): DbError {
  if (e && typeof e === 'object') {
    const pe = e as PostgrestLike
    const message = str(pe.message) ?? ''
    const sqlState = str(pe.code)
    const parsed = parseSqlMessage(message)
    if (parsed) return makeDbError(parsed.code, parsed.detail, sqlState)
    if (sqlState === 'P0001') return makeDbError('guard_violation', message, sqlState)
    if (sqlState && SQLSTATE_MAP[sqlState]) return makeDbError(SQLSTATE_MAP[sqlState], message || undefined, sqlState)
    if (sqlState?.startsWith('22')) return makeDbError('invalid_value', message || undefined, sqlState)
    if (sqlState?.startsWith('23')) return makeDbError('check_violation', message || undefined, sqlState)
    if (e instanceof TypeError || /fetch failed|failed to fetch|network/i.test(message)) {
      return makeDbError('network', message || undefined)
    }
    return makeDbError('unknown', message || undefined, sqlState)
  }
  if (typeof e === 'string') {
    const parsed = parseSqlMessage(e)
    return parsed ? makeDbError(parsed.code, parsed.detail) : makeDbError('unknown', e)
  }
  return makeDbError('unknown')
}

/** Thrown by `unwrap` for callers that prefer exceptions (server components). */
export class DbException extends Error {
  readonly error: DbError
  constructor(error: DbError) {
    super(`${error.code}${error.detail ? `: ${error.detail}` : ''}`)
    this.name = 'DbException'
    this.error = error
  }
}

export function ok<T>(data: T): DbResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: DbError): DbResult<T> {
  return { ok: false, error }
}

/** Returns the data or throws a DbException. */
export function unwrap<T>(result: DbResult<T>): T {
  if (result.ok) return result.data
  throw new DbException(result.error)
}

export function isDbErrorCode(value: string): value is DbErrorCode {
  return SQL_CODES.has(value) || (CLIENT_ERROR_CODES as readonly string[]).includes(value)
}
