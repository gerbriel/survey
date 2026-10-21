# Survey: agent guide

Internal multi-workspace survey and form builder. Design lives in `docs/`; `docs/00-decisions.md` wins every conflict. Read 00, your assigned doc sections, and this file before writing anything.

## This is not the Next.js you remember

Next 16 has breaking changes in APIs, conventions, and file names (for example `src/proxy.ts` replaced `middleware.ts`). Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code and heed deprecation notices. `agentRules: false` is set in `next.config.ts` because the block `next dev` would otherwise write here contains an em dash.

## Stack and versions

| Piece | Version |
|---|---|
| Node | 22.12 or newer (developed on 22.19.0) |
| pnpm | 10.34.7 via corepack (`packageManager` in package.json) |
| Next.js | 16.4.2, App Router, Turbopack, `src/` layout |
| React | 19.3.1 |
| TypeScript | 5.9, `strict` plus `noUncheckedIndexedAccess` |
| Tailwind | 4.3 via `@tailwindcss/postcss`, tokens in `src/app/globals.css` |
| ESLint | 9 with `eslint-config-next` 16.4.2 (core web vitals, TypeScript, React Compiler rules) |
| Vitest | 5 |
| Supabase CLI | 2.53.6 (Postgres 17 locally) |

pnpm note: `corepack enable pnpm` cannot write to `/usr/local/bin` on the owner's machine, so the shim lives in `~/.local/bin` (`corepack enable --install-directory ~/.local/bin pnpm`). `pnpm@latest` (12.x) does not run under the bundled corepack 0.34, so the repo pins pnpm 10.

## The rules that matter

### 1. Two hostnames, one deployment (R15)

`PUBLIC_HOST` serves only the `(public)` route group and `/api/public/*`. `DASHBOARD_HOST` serves everything else. Reason: workspace pixels, GTM containers and `custom_script` snippets run on public pages with full page access. If they shared an origin with the dashboard they could read a signed-in member's Supabase session. Separate hostnames make that a cross-origin read the browser refuses.

Consequences you must keep:
- `src/proxy.ts` decides routing by hostname and sets one CSP per response. The two root layouts check the host again (second guard).
- Supabase auth cookies are host-only to `DASHBOARD_HOST` (no `Domain` attribute). Public pages use the anon client with no cookie adapter.
- Nothing under `src/app/(public)/**` imports `src/lib/supabase/server` or `src/lib/supabase/admin`. ESLint `no-restricted-imports` fails the build if it does.
- Nothing under `src/app/(dashboard)/**` imports `src/components/public/pixels`. Pixels never load on the dashboard host, builder preview included.
- A new top-level dashboard route segment must be added to `DASHBOARD_SEGMENTS` in `src/lib/hosts.ts`, or the proxy 404s it. Those names are also reserved and can never be survey aliases.

### 2. The anon role has exactly two SQL functions and no table grants

`resolve_public_survey(key)` and `get_public_definition(version_id, key)`, both `SECURITY DEFINER`, both return nothing for an unknown key. No anon `select`, `insert`, `update` or `delete` on any table, ever. Public submissions go through a route handler that verifies Turnstile and writes with the service role inside one SQL function. `pnpm test:sql` asserts the anon privilege set.

### 3. Authorization lives in RLS and SQL functions

Every tenant table has RLS backed by `is_member(workspace_id, min_role)`. Route guards (`requireMember` and friends, layout checks, hidden buttons) are UX only. They exist so the UI renders sensibly; the database is what refuses a request. `createAdminClient()` bypasses RLS: import it only from route handlers that already authenticated and authorized the caller, never from a client component, never under `(public)`.

### 4. No em or en dashes

Owner rule for every file: UI copy, docs, comments, commit messages. Rewrite with a period, comma, colon, or plain hyphen. `pnpm check:copy` greps `src/`, `docs/`, `README.md` and this file for U+2014 and U+2013 and fails on any hit.

## Gates

Every phase ends green on all of these:

```
pnpm typecheck     # tsc --noEmit, strict
pnpm lint          # eslint incl. no-restricted-imports for (public) and (dashboard)
pnpm test          # vitest (tests/unit and src/**/*.test.ts)
pnpm build         # next build
pnpm db:reset      # supabase db reset: every migration from zero, then seed.sql (needs Docker)
pnpm test:sql      # TODO(Phase 1A): placeholder that prints "requires docker"; becomes the anon privilege and RLS matrix tests
pnpm check:copy    # no em or en dashes
```

`pnpm db:types` regenerates `src/types/database.ts` from the local database (Phase 1D).

## Running locally

See README "Run locally". Short version: copy `.env.example` to `.env.local`, `pnpm dev`, open `http://survey.localhost:3000` (dashboard) and `http://s.localhost:3000` (public). Plain `localhost:3000` is an unknown host and returns 404 by design.

## Module ownership

From `docs/06-build-plan.md`. An agent writes only inside its rows. Any file not listed is owned by the phase that creates it, and the agent must say so in its report.

| Path | Owner |
|---|---|
| `AGENTS.md` | Phase 0, then Fable |
| `docs/` | design docs, Fable only |
| `supabase/config.toml` | Phase 0 |
| `supabase/migrations/0001..0017_*.sql` | 1A, per doc 01 section 15 |
| `supabase/seed.sql` | 1A |
| `supabase/tests/*.sql` | 1A |
| `src/proxy.ts` | Phase 0 skeleton; 1D adds session refresh |
| `src/app/(public)/layout.tsx` | 2C |
| `src/app/(public)/[key]/page.tsx` | 2C |
| `src/app/(public)/report/page.tsx` | 2C |
| `src/app/(public)/privacy/page.tsx` | 2C |
| `src/app/(public)/r/[token]/page.tsx` | 2E |
| `src/app/(dashboard)/login/`, `pending/`, `invite/[token]/` | 2A |
| `src/app/(dashboard)/w/[slug]/layout.tsx` | 2A |
| `src/app/(dashboard)/w/[slug]/dashboard/` | 2E |
| `src/app/(dashboard)/w/[slug]/surveys/` (list, create, templates) | 2B |
| `src/app/(dashboard)/w/[slug]/surveys/[id]/edit/` | 2B |
| `src/app/(dashboard)/w/[slug]/surveys/[id]/share/` | 2B |
| `src/app/(dashboard)/w/[slug]/surveys/[id]/responses/` | 2D |
| `src/app/(dashboard)/w/[slug]/surveys/[id]/analytics/` | 2E |
| `src/app/(dashboard)/w/[slug]/surveys/[id]/reports/` | 2E |
| `src/app/(dashboard)/w/[slug]/contacts/` | 2D |
| `src/app/(dashboard)/w/[slug]/privacy-tools/` | 2E |
| `src/app/(dashboard)/w/[slug]/settings/` | 2A |
| `src/app/(dashboard)/admin/` | 2A |
| `src/app/api/auth/callback/route.ts` | 2A |
| `src/app/api/public/submit`, `resume`, `upload`, `report`, `og` | 2C |
| `src/app/api/public/events/route.ts` | 2E |
| `src/app/api/cron/orphan-sweep` | 2C |
| `src/app/api/cron/retention` | 2E |
| `src/app/api/cron/workspace-purge` | 2A |
| `src/components/ui/*` | Phase 0 |
| `src/components/survey/renderer/*` | 1C |
| `src/components/builder/*` | 2B |
| `src/lib/survey/` | 1B |
| `src/lib/supabase/` | 1D (Phase 0 left throwing stubs) |
| `src/lib/db/` | 1D |
| `src/lib/public/` | 2C |
| `src/lib/qr.ts` | 2B |
| `src/lib/crm/` | 2D |
| `src/lib/analytics/`, `src/lib/exports/` | 2E |
| `src/lib/admin/` | 2A |
| `src/types/database.ts` | 1D, generated |
| `tests/unit/` | each module adds its own |
| `tests/e2e/` | 3A |
| `scripts/check-copy.sh` | Phase 0 |
| `vercel.json` | Phase 4 |

Files Phase 0 created outside the table: `src/lib/hosts.ts` (host routing rules), `src/lib/request-context.ts` (`getNonce`, `getHostKind`), `src/app/(public)/%5Fhome/page.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/dev/renderer/page.tsx` (1C fills it), `src/app/globals.css`, `tests/unit/hosts.test.ts`. Phase 0 owns them until a later phase takes them over.

## Looks wrong but is deliberate

- **The dashboard host answers `/s/{key}` with a 302 to `PUBLIC_HOST/{key}`.** It is not a duplicate route. A pasted link with the wrong host must never 404, and the survey must never render on the dashboard origin. The query string is kept so `?t=` tokens and hidden fields survive. In `next dev` the redirect uses `http`; everywhere else `https`.
- **Two different Content-Security-Policy headers.** The public policy has `'strict-dynamic'` and open `https:` for img, connect and frame because GTM and vendor snippets load and beacon anywhere; script execution is still nonce gated. The dashboard policy is self plus the Supabase origin only, no third-party scripts. Both are set in `src/proxy.ts`, one per response, never in `next.config.ts`, so they cannot intersect by accident. `'unsafe-eval'` appears only under `next dev`.
- **The public host's `/` is a rewrite to `/_home`.** Two route groups cannot both define `/`, and the dashboard owns it. The folder is `(public)/%5Fhome` because a leading underscore can never be a slug or alias. Direct requests for `/_home` 404 on both hosts.
- **Unknown hosts get a 404, including plain `localhost` and `*.vercel.app` previews.** Previews need the two hostnames mapped (doc 02 mentions a `DEV_HOST_MAP` for this; not built yet).
- **`/api/cron/*` passes through the proxy with no CSP and no session.** The handler checks `CRON_SECRET`; there is no HTML to protect.
- **`/dev/*` 404s outside `next dev`.** It is a fixture gallery, not a product page.
- **The Supabase client files throw.** They are Phase 0 stubs so the lint rule has real targets. Phase 1D implements them.
