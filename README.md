# Survey

Internal multi-workspace survey and form builder. Workspaces are departments. Signed-in users are invite only. Survey links are public.

Phase 0 scaffold: an empty Next.js app with hostname routing, CSP, UI primitives and gates. Agent conventions are in `AGENTS.md`. The design lives in `docs/`:

| Doc | What it settles |
|---|---|
| `docs/00-decisions.md` | Cross-cutting decisions, stack, tenancy, reconciliation rulings. Read first. Wins every conflict. |
| `docs/01-data-model.md` | Every table, RLS policy, SQL function, and the 17-step migration plan. Single schema source. |
| `docs/02-public-delivery.md` | Two hostnames, slugs and aliases, survey states, submission handler, uploads, pixels, QR, footer. |
| `docs/03-builder-and-logic.md` | Question types, definition JSON, logic engine, shared validator, renderer, builder UX, publish flow. |
| `docs/04-crm-analytics-privacy.md` | Contacts and leads, identity resolution, events, analytics, reports, exports, privacy controls. |
| `docs/05-workspaces-and-admin.md` | Workspace lifecycle, roles, invites, onboarding without email, settings, platform admin. |
| `docs/06-build-plan.md` | Phases, agent ownership, verification gates, deployment, consolidated open questions. |

Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Supabase (Postgres with RLS, Auth, Storage), Vercel, Cloudflare Turnstile.

Copy rule: no em or en dashes anywhere in UI text or docs.

## Run locally

Requirements: Node 22.12 or newer, pnpm 10 (via corepack, see `AGENTS.md`), Supabase CLI, and Docker for the local database.

```
pnpm install
cp .env.example .env.local      # fill in Supabase keys after `supabase start`
supabase start                  # local Postgres, Auth, Storage (needs Docker)
pnpm dev
```

The app answers on two hostnames from one dev server (ruling R15):

| URL | What it serves |
|---|---|
| `http://survey.localhost:3000` | dashboard (`DASHBOARD_HOST`) |
| `http://s.localhost:3000` | public survey pages (`PUBLIC_HOST`) |

Plain `http://localhost:3000` is an unknown host and returns 404 on purpose.

How `*.localhost` resolves on macOS: browsers (Chrome, Firefox) and curl resolve any `*.localhost` name to loopback themselves, so no `/etc/hosts` edit is needed for them. The macOS system resolver does not: `dscacheutil -q host -a name s.localhost` returns nothing and `ping s.localhost` fails (checked 2026-10-21 on macOS 15.2, where curl 8.7.1 reached `s.localhost:3000` via `::1`). Tools that use the system resolver (Node `fetch`, Python, Playwright's request client in some setups) need either these two lines in `/etc/hosts` or a `Host` header:

```
127.0.0.1 survey.localhost s.localhost
::1       survey.localhost s.localhost
```

Quick check without a browser:

```
curl -i http://s.localhost:3000/                 # 200, "Use the link you were given."
curl -i http://s.localhost:3000/login            # 404, dashboard paths never render on the public host
curl -i http://survey.localhost:3000/s/abc123xyz0   # 302 to http://s.localhost:3000/abc123xyz0
```

## Gates

Every phase ends green on all of these (see `docs/06-build-plan.md`):

```
pnpm typecheck     # tsc --noEmit, strict
pnpm lint          # eslint, incl. the (public) import restrictions
pnpm test          # vitest
pnpm build         # next build
pnpm db:reset      # supabase db reset (needs Docker)
pnpm test:sql      # SQL assertions (placeholder until Phase 1A)
pnpm check:copy    # fails on any em or en dash
```

## Production

Vercel project `survey`, auto deploys from `main`. Two hostnames on one deployment, per ruling R15:

| Host | Serves |
|---|---|
| `survey-sand-six.vercel.app` | dashboard (`DASHBOARD_HOST`) |
| `survey-public-gr.vercel.app` | public survey pages (`PUBLIC_HOST`) |

Production env vars are set in the Vercel project from `.env.local` names; see `.env.example` for the list. Cron schedules live in `vercel.json`. Supabase Site URL and redirect URLs must include the dashboard host; the Turnstile widget must include the public host. When a custom domain arrives, swap both hosts in the Vercel env vars, Supabase, and Turnstile, then redeploy.
