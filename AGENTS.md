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

Every tenant table has RLS backed by `is_member(workspace_id, min_role)`. Route guards (`requireMember` and friends, layout checks, hidden buttons) are UX only. They exist so the UI renders sensibly; the database is what refuses a request. `createAdminClient()` bypasses RLS. It is created only inside server-only modules under `src/lib` (for example `src/lib/public/submit.ts`), and those modules are called from route handlers that have already verified the caller: Turnstile plus rate limits for public submissions, `requireMember` or `requirePlatformAdmin` for dashboard work. Nothing under `src/app` imports it; ESLint enforces that.

### 4. No em or en dashes

Owner rule for every file: UI copy, docs, comments, commit messages. Rewrite with a period, comma, colon, or plain hyphen. `pnpm check:copy` greps `src/`, `docs/`, `supabase/`, `README.md` and this file for U+2014 and U+2013 and fails on any hit.

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

## Data access (Phase 1D)

### Which client where

All four live in `src/lib/supabase/`. Each returns a branded type (`UserClient`, `AnonClient`, `AdminClient` from `src/lib/supabase/types.ts`) so a wrapper can refuse the wrong one at compile time.

| Client | File | Runs as | Use from | Never from |
|---|---|---|---|---|
| `createServerClient()` (async) | `server.ts` | signed-in member, RLS applies | dashboard server components, layouts, server actions, route handlers on `DASHBOARD_HOST` | `(public)`, client components |
| `createBrowserClient()` | `browser.ts` | signed-in member, RLS applies | dashboard client components (realtime, uploads) | `(public)` |
| `createAnonClient()` | `anon.ts` | anon, no cookie adapter, no session | `(public)` pages and `/api/public/*`, only for `resolve_public_survey` and `get_public_definition` | anything that needs a member |
| `createAdminClient()` | `admin.ts` | service role, bypasses RLS | server-only library code under `src/lib` (for example `src/lib/public/*`, cron helpers) after Turnstile, `CRON_SECRET`, or an explicit auth check | anything under `src/app`, client components |
| `updateSession(req, headers)` | `proxy.ts` | refreshes the member session | `src/proxy.ts`, dashboard branch only | everything else |

Cookie rules (`cookies.ts`, unit tested): no `Domain` attribute ever (host-only to `DASHBOARD_HOST`), `Path=/`, `SameSite=Lax`, `Secure` everywhere except `next dev`. Every write goes through `hostOnlyCookieOptions`, which strips a `Domain` (and any `name`) even if the library passes one. In production the auth cookie is named `__Host-sb-auth` through `cookieOptions.name` (S12), so a parent-domain cookie tossed from `PUBLIC_HOST` cannot shadow it; dev keeps the library default because `__Host-` needs `Secure`.

ESLint enforces the matrix: under `src/app/**` the admin client and the raw `@supabase/supabase-js` and `@supabase/ssr` imports are refused (type-only imports are allowed); under `src/app/(public)/**` the server, browser and proxy clients and `src/lib/auth` are refused too. This tightens rule 3 above: route handlers reach the service role through a server-only module in `src/lib`, not by importing `admin.ts` themselves.

### Pages never query directly

Pages, layouts, server actions and route handlers never call `.from()` or `.rpc()`. They call `src/lib/db/*`. Each wrapper takes the client as its first argument, validates input with zod, calls one SQL function (or one table query under RLS) with the exact SQL argument names, and returns `DbResult<T>`:

```ts
import { saveDraft } from '@/lib/db/surveys'
const r = await saveDraft(supabase, { versionId, expectedRevision, definition })
if (!r.ok) switch (r.error.code) { case 'revision_conflict': ...; case 'lock_lost': ... }
```

Wrappers never throw. `unwrap(result)` from `@/lib/db/errors` throws a `DbException` for code that prefers exceptions. A module that needs a new query adds a wrapper to the matching file below (one area per file; add a file only when none fits). Library modules (`src/lib/analytics`, `src/lib/crm`, `src/lib/public`, ...) call the wrappers too; they do not keep local `call()` wrappers.

`src/app` never imports `src/lib/db/rpc.ts` (the `call` plumbing and shared zod schemas); ESLint refuses it. Schemas a form needs are re-exported by the wrapper file (for example `workspaceSlug` from `workspaces.ts`).

Exceptions, all server-only code under `src/lib`: Storage API calls (uploads, signed URLs, removals) and the Auth admin API (`src/lib/admin/service.ts`) are not SQL and stay in the module that needs them; the queued Storage removal shared by purge, retention and erase is `removeQueuedObjects` in `exports.ts`.

Files:

| File | Area | Clients |
|---|---|---|
| `workspaces.ts` | workspace reads, lifecycle functions, settings writes, logo storage, slug history, members (`listMembers`, `listMembersWithEmail`), activity log | user |
| `profiles.ts` | profile read, `last_workspace_id`, `is_platform_admin` | user |
| `invites.ts` | invite claiming, `invitePreview`, workspace invite links | user |
| `admin.ts` | platform admin functions, self-auditing `admin_*` writes, `adminWorkspaceStats`, platform reads, access and workspace requests, purge (`workspacePurgeDue`, `purgeWorkspace`, `pendingStorageDeletions`), `privacyNotice` and `insertAbuseReport` for public routes, `insertPlatformAudit` for Auth admin API actions only | user, service role where noted |
| `pixels.ts` | workspace pixels | user |
| `surveys.ts` | create, alias, locks, autosave, survey and version reads, settings update | user (reads also service role) |
| `templates.ts` | survey templates | user |
| `publish.ts` | `publish_survey_version` | user |
| `publicRead.ts` | `resolve_public_survey`, `get_public_definition` (anon only), `ogCard` (service role) | anon, service role |
| `submission.ts` | `submit_response`, `create_upload`, `rate_limit_hit`, published version and resume reads | service role |
| `events.ts` | `record_events` (service role), `readEvents` (user) | both |
| `contacts.ts` | contact functions, CRM table queries, `finishImport`, export lookups | user |
| `responses.ts` | `filtered_responses` paging and counts, answers, inbox and response detail, file links | user (reads also service role) |
| `reports.ts` | `shared_report_payload` and `reportShareGate` (service role), `hashSharePassword`, reports, widgets, shares, dashboard counts | user, service role |
| `exports.ts` | storage cleanup jobs, `removeQueuedObjects`, export jobs, `logExport` (`log_export`) | user, service role |
| `privacy.ts` | erase, GDPR export, retention, respondent finder | user, service role |
| `limits.ts` | `effective_limits`, `GLOBAL_LIMIT_DEFAULTS` (pinned to SQL by a test) | user, service role |
| `errors.ts`, `rpc.ts` | error contract; `call` plumbing, shared schemas and paging helpers | library only |

### Error code contract

SQL raises the code as the exception message, optionally `code: detail` (`revision_conflict`, `lock_lost`, `server_only_key_in_public_definition: score`). `toDbError` maps it to `DbError { code, detail?, message, category, sqlState? }`. `message` is plain copy safe to show a member. `category` groups codes as `auth`, `lock`, `survey`, `limit`, `input`, `conflict`, `system` (the build plan's prefixes; the SQL itself uses flat codes). Non-SQL failures map to `invalid_input` (zod), `guard_violation` (trigger sentence), `permission_denied` (42501, missing grant or RLS), `unique_violation`, `foreign_key_violation`, `check_violation`, `invalid_value`, `no_rows`, `session_expired`, `function_not_found`, `network`, `unknown`.

`SQL_ERROR_CODES` in `errors.ts` lists every code the migrations raise; a unit test greps the migrations and fails when a new code is missing. `submit_response` and `create_upload` return `{ok:false, code}` as data for expected outcomes (`cap_reached`, `token_used`, `validation_failed`, `file_size`, ...), so those arrive as `r.data`, not `r.error`.

### Auth helpers

`src/lib/auth` (server only, dashboard group): `requireUser`, `requireMember(slug, minRole)`, `requirePlatformAdmin`, `getCurrentWorkspace`, `getAuthContext`, role ordering (`roleAtLeast`, `memberCan`, mirroring `is_member`), `getGoogleSignInUrl`, `setInviteCookie`, `claimInvitesFromCookies`, `handleAuthCallback`. The guards redirect for UX only; RLS is the authorization.

### database.ts provenance

`src/types/database.ts` was generated on 2026-10-21 from the throwaway Postgres 17 stand-in (all migrations plus seed), not from the Supabase stack: `supabase gen types` needs Docker for its postgres-meta image, so the same generator ran from the `@supabase/postgres-meta` npm package (`PG_META_GENERATE_TYPES=typescript`). Regenerate with `pnpm db:types` once Docker exists and diff it. Short aliases (`Tables<'surveys'>`, `Enums<'workspace_role'>`) live in `src/types/db-helpers.ts`. The integration tests in `src/lib/db/__tests__/integration/` skip unless `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set; they have not run yet.

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
| `src/lib/db/` | 1D; I2 consolidated every module's wrappers here |
| `src/lib/public/` | 2C |
| `src/lib/qr.ts` | 2B |
| `src/lib/crm/` (no data access since I2) | 2D |
| `src/lib/analytics/`, `src/lib/exports/` | 2E |
| `src/lib/admin/` (no data access; wrappers moved to `src/lib/db` in I2) | 2A |
| `src/types/database.ts` | 1D, generated |
| `tests/unit/` | each module adds its own |
| `tests/e2e/` | 3A |
| `scripts/check-copy.sh` | Phase 0 |
| `vercel.json` | Phase 4 |

Files Phase 0 created outside the table: `src/lib/hosts.ts` (host routing rules), `src/lib/request-context.ts` (`getNonce`, `getHostKind`), `src/app/(public)/%5Fhome/page.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/dev/renderer/page.tsx` (1C fills it), `src/app/globals.css`, `tests/unit/hosts.test.ts`. Phase 0 owns them until a later phase takes them over.

## Security review rules (doc 07)

- Client IP comes only from `clientIp()` in `src/lib/public/http.ts`: `x-vercel-forwarded-for`, then `x-real-ip`, then the LAST `x-forwarded-for` entry. Rate limit keys hash it with `hashIp`, which reduces IPv6 to /64 (S9, R17).
- Public routes check per-IP buckets, then Turnstile, then any shared per-survey bucket (S2, R17).
- The public page keeps no answers in browser storage: only the resume token and the respondent id (S3, R16). GTM and custom scripts load only when `raw_script_pixels_allowed` is true, decided by pixel type.
- Dashboard pages and actions that take an id from the URL call `assertBelongsToWorkspace` in `src/lib/scope.ts` before other queries (D-15).
- `vercel.json` schedules the three cron routes; Vercel Cron calls the production domain, which must be `DASHBOARD_HOST` (the proxy 404s other hosts).

## Looks wrong but is deliberate

- **The dashboard host answers `/s/{key}` with a 302 to `PUBLIC_HOST/{key}`.** It is not a duplicate route. A pasted link with the wrong host must never 404, and the survey must never render on the dashboard origin. The query string is kept so `?t=` tokens and hidden fields survive. In `next dev` the redirect uses `http`; everywhere else `https`.
- **Two different Content-Security-Policy headers.** The public policy has `'strict-dynamic'` and open `https:` for img, connect and frame because GTM and vendor snippets load and beacon anywhere; script execution is still nonce gated. The dashboard policy is self plus the Supabase origin only, no third-party scripts. Both are set in `src/proxy.ts`, one per response, never in `next.config.ts`, so they cannot intersect by accident. `'unsafe-eval'` appears only under `next dev`.
- **The public host's `/` is a rewrite to `/_home`.** Two route groups cannot both define `/`, and the dashboard owns it. The folder is `(public)/%5Fhome` because a leading underscore can never be a slug or alias. Direct requests for `/_home` 404 on both hosts.
- **Unknown hosts get a 404, including plain `localhost` and `*.vercel.app` previews.** Previews need the two hostnames mapped (doc 02 mentions a `DEV_HOST_MAP` for this; not built yet).
- **`/api/cron/*` passes through the proxy with no CSP and no session.** The handler checks `CRON_SECRET`; there is no HTML to protect.
- **`/dev/*` 404s outside `next dev`.** It is a fixture gallery, not a product page.
