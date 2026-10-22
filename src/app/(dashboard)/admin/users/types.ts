import type { requirePlatformAdmin } from '@/lib/auth'

export type AdminCtx = Awaited<ReturnType<typeof requirePlatformAdmin>>
export type SearchParams = Record<string, string | string[] | undefined>
