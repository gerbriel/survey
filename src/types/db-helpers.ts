/**
 * Short aliases over the generated `src/types/database.ts`, so modules write
 * `Tables<'surveys'>` instead of the long generated generics. This file is
 * hand-written; database.ts is generated and must not be edited by hand.
 */
import type { Database, Json } from './database'

export type { Database, Json }

type PublicSchema = Database['public']

export type TableName = keyof PublicSchema['Tables']
export type EnumName = keyof PublicSchema['Enums']
export type FunctionName = keyof PublicSchema['Functions']

/** Row type of a public table, for example `Tables<'workspaces'>`. */
export type Tables<T extends TableName> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends TableName> = PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends TableName> = PublicSchema['Tables'][T]['Update']

/** Enum union, for example `Enums<'workspace_role'>`. */
export type Enums<T extends EnumName> = PublicSchema['Enums'][T]

/** Argument and return shapes of a SQL function as PostgREST sees them. */
export type FunctionArgs<T extends FunctionName> = PublicSchema['Functions'][T]['Args']
export type FunctionReturns<T extends FunctionName> = PublicSchema['Functions'][T]['Returns']

export type WorkspaceRole = Enums<'workspace_role'>
export type ProfileStatus = Enums<'profile_status'>
