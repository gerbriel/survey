/**
 * Data access for the whole app. Pages, layouts, server actions and route
 * handlers never query Supabase directly; they call these wrappers. Each
 * wrapper validates input with zod, calls one SQL function (or one table
 * query under RLS), and returns DbResult<T>. See AGENTS.md "Data access".
 *
 * Server-only modules can import from here freely. Client components should
 * import the specific file they need to keep bundles small.
 */
export * from './errors'
export type { StorageDeletion } from './rpc'
export * as adminDb from './admin'
export * as assignmentsDb from './assignments'
export * as contactsDb from './contacts'
export * as eventsDb from './events'
export * as exportsDb from './exports'
export * as imagesDb from './images'
export * as invitesDb from './invites'
export * as limitsDb from './limits'
export * as pixelsDb from './pixels'
export * as privacyDb from './privacy'
export * as profilesDb from './profiles'
export * as publicReadDb from './publicRead'
export * as publishDb from './publish'
export * as reportsDb from './reports'
export * as responsesDb from './responses'
export * as submissionDb from './submission'
export * as surveysDb from './surveys'
export * as templatesDb from './templates'
export * as workspacesDb from './workspaces'
