import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DASHBOARD_SEGMENTS } from '@/lib/hosts'
import { RESERVED_ALIASES } from '../share'

/**
 * Snapshot of the array returned by SQL reserved_public_segments(), as last
 * defined in supabase/migrations (0018_phase2_followups.sql today).
 *
 * To refresh after a migration redefines the function: copy its array
 * literal here, then make RESERVED_ALIASES in src/lib/builder/share.ts (and
 * DASHBOARD_SEGMENTS in src/lib/hosts.ts, for dashboard routes) match. The
 * second test below fails until the snapshot equals the newest definition.
 */
const SQL_RESERVED_PUBLIC_SEGMENTS = [
  'w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev', 'welcome', 'join',
  'api', 's', 'r', 'f', 'e', 'logout', 'app', 'www', 'static', 'well-known', 'privacy',
  'report', 'robots', 'favicon',
]

/** The array literal of the last `create or replace function reserved_public_segments()` in the migrations. */
function latestSqlList(): string[] {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let body: string | null = null
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    for (const m of sql.matchAll(/create or replace function reserved_public_segments\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/g)) body = m[1]!
  }
  if (!body) throw new Error('reserved_public_segments() not found in supabase/migrations')
  return [...body.replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('reserved aliases', () => {
  it('RESERVED_ALIASES equals the SQL snapshot', () => {
    expect([...RESERVED_ALIASES].sort()).toEqual([...SQL_RESERVED_PUBLIC_SEGMENTS].sort())
  })
  it('the snapshot equals the newest reserved_public_segments() in the migrations', () => {
    expect([...SQL_RESERVED_PUBLIC_SEGMENTS].sort()).toEqual(latestSqlList().sort())
  })
  it('every dashboard segment is reserved', () => {
    for (const s of DASHBOARD_SEGMENTS) expect(RESERVED_ALIASES).toContain(s)
  })
})
