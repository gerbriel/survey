# 02. Public delivery

How a published survey reaches a respondent and how a submission gets back safely. Builds on `00-decisions.md`. Tables owned elsewhere live in doc 01 (the single schema source, R11; SQL here is illustration); the validator and renderer in doc 03; workspace settings and `workspace_limits` in doc 05.

Conventions from 559flawless: `src/proxy.ts` (Next 16's name for middleware), `updateSession()` from `src/lib/supabase/proxy.ts`, security headers in one place with reasons beside them, service-role client only in route handlers.

---

## 1. Two fixed hostnames, one deployment

One organization domain, two fixed hostnames, both attached to the same Vercel project (R15):

- `DASHBOARD_HOST` (placeholder `survey.example.org`): dashboard, sign in, admin, cron.
- `PUBLIC_HOST` (placeholder `s.example.org`): public surveys, privacy notice, public APIs.

Nothing is per workspace. Previews and local dev map both through `DEV_HOST_MAP` (for example `s.localhost:3000=public`).

| Host | Path | Who | Session | CSP |
|---|---|---|---|---|
| public | `/{slug}`, `/{alias}` | anyone | none exists | public (nonce plus `strict-dynamic`, pixels allowed) |
| public | `/privacy` | anyone | none exists | public, no pixels |
| public | `/api/public/*` | anyone | none exists | public |
| public | `/` | anyone | none | neutral page, "Use the link you were given." |
| dashboard | `/s/{key}` | anyone | ignored | 302 to `https://{PUBLIC_HOST}/{key}` (query string kept) |
| dashboard | `/w/{workspace-slug}/...`, `/admin`, `/login`, `/auth/*`, `/` | members | refreshed by `updateSession` | dashboard (no third-party scripts) |
| dashboard | `/api/cron/*` | Vercel Cron | none, `CRON_SECRET` | none needed |

```
src/app/
  (public)/
    [key]/page.tsx        survey, state screens, thank you (rewrite target, see proxy)
    privacy/page.tsx      organization privacy notice
    layout.tsx            public layout: pixels, consent UI, footer, nonce
  (app)/
    w/[workspace]/...     dashboard, builder preview (pixels disabled)
    admin/...             platform admin: workspaces, users, settings (R21)
    login/, auth/         sign in, OAuth callback, invite accept
  api/public/...          submit, resume, uploads, report, og
  api/cron/...            orphan upload sweep, retention (doc 04)
```

```ts
// src/proxy.ts (sketch)
const PUBLIC_ALLOW = [
  /^\/$/,
  /^\/[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,   // /{slug} or /{alias}
  /^\/api\/public\//,
  /^\/(robots\.txt|favicon\.ico)$/,
]

export async function proxy(req: NextRequest) {
  const host = normalizeHost(req.headers.get('host'))   // lowercase, strip port, apply DEV_HOST_MAP
  const path = req.nextUrl.pathname
  const nonce = crypto.randomUUID().replaceAll('-', '')

  if (host === PUBLIC_HOST) {
    // Never the dashboard, never updateSession, never an auth cookie.
    if (!PUBLIC_ALLOW.some((r) => r.test(path))) return notFound()
    return withPublicCsp(NextResponse.next({ request: { headers: withNonce(req, nonce) } }), nonce)
  }
  if (host !== DASHBOARD_HOST) return notFound()
  if (path.startsWith('/s/')) {
    return NextResponse.redirect(`https://${PUBLIC_HOST}/${path.slice(3)}${req.nextUrl.search}`, 302)
  }
  if (path.startsWith('/api/public/')) return notFound()
  if (path.startsWith('/api/cron/')) return NextResponse.next()   // handler checks CRON_SECRET
  return withAppCsp(await updateSession(req, withNonce(req, nonce)), nonce)
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] }
```

`/privacy` matches the `/{key}` pattern and is served by its own route; it and `report` (whose page R21 removed, so `/report` now 404s as an unknown key) stay reserved aliases (section 2). The `(app)` layout also calls `notFound()` unless the host is `DASHBOARD_HOST`, as a second guard.

**Origin isolation (R15).** Supabase auth cookies are set without a `Domain` attribute, so they are host-only to `DASHBOARD_HOST` and never sent to or readable from `PUBLIC_HOST`. A GTM container or `custom_script` on a public page runs on a different origin from every member session. Public pages create their Supabase client with the anon key and no cookie adapter; the `(public)` layout never imports `src/lib/supabase/server.ts`, enforced by ESLint `no-restricted-imports`.

**Builder preview** renders the same `<SurveyRenderer>` on `DASHBOARD_HOST` under the dashboard CSP with pixels disabled, so no workspace script ever runs next to a session.

**Surveys never move between workspaces.** `surveys.workspace_id` is immutable (trigger rejects updates). Duplicating into another workspace creates a new survey with a new slug.

---

## 2. Slugs and aliases

- URL: `https://{PUBLIC_HOST}/{key}`. The dashboard host redirects `/s/{key}` there (section 1).
- `key` is either the survey's `slug` (random 10 chars from `[a-z0-9]`, generated in SQL, globally unique) or a vanity alias.

```sql
create table survey_aliases (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references surveys(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  alias         text not null check (
                  alias ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'
                  and alias !~ '^[a-z0-9]{10}$'          -- cannot look like a slug
                  and alias not in ('api','s','w','admin','login','auth','app','www','static','well-known',
                                  'report','privacy','robots','favicon')
                ),
  retired_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- One namespace for the whole deployment. Retired rows keep the alias until deleted.
create unique index survey_aliases_alias_uq on survey_aliases (alias);
create unique index survey_aliases_live_uq  on survey_aliases (survey_id) where retired_at is null;
```

Resolution: try slug first, then alias. A survey holds at most one live alias. Renaming sets `retired_at` on the old row; a retired alias keeps resolving to its survey for 30 days, so printed links survive a rename, and nobody can take it during the hold. pg_cron deletes retired rows older than 30 days, which frees the alias. The rename dialog says when the old alias stops working. The slug always works and never changes.

---

## 3. Survey states

`surveys.state` is the owner's intent; the effective state is computed in SQL at read time. No cron flips states.

```sql
-- check (state <> 'scheduled' or opens_at is not null)
-- check (closes_at is null or opens_at is null or closes_at > opens_at)
create function survey_effective_state(s surveys)
returns table (state text, reason text)
language sql stable as $$
  select case
    when s.state = 'draft' or s.published_version_id is null then 'draft'
    when s.state = 'closed'                                     then 'closed'
    when s.opens_at  is not null and now() <  s.opens_at        then 'scheduled'
    when s.closes_at is not null and now() >= s.closes_at       then 'closed'
    when s.response_cap is not null
         and s.complete_count >= s.response_cap                 then 'closed'
    else 'open' end,
  case
    when s.state = 'closed' then 'manual'
    when s.closes_at is not null and now() >= s.closes_at then 'schedule'
    when s.response_cap is not null and s.complete_count >= s.response_cap then 'cap'
  end
$$;
```

A reached cap shows as `closed` with reason `cap`; `surveys.state` is not changed (R10), so raising the cap reopens the survey.

| Effective state | Public page renders | HTTP |
|---|---|---|
| `draft` | Generic 404, identical to unknown key | 404 |
| `scheduled` | Title, workspace branding, "Opens {date}" rendered in the viewer's time zone via `<time>`. If opening within the hour, the client calls `router.refresh()` at `opens_at`. No questions are sent. | 200 |
| `open` | The survey | 200 |
| `closed` | Title, branding, `closed_message` (plain text, max 1,000 chars, line breaks kept). Default for every reason: "This survey is no longer accepting responses." | 200 |

Members preview drafts in the dashboard, never through the public route.

Grace rule: a response whose `started_at` is before a **scheduled** `closes_at` may complete up to 15 minutes after it. Manual close and caps are strict.

---

## 4. Public read path

Anon has no table grants (R1). It can execute exactly two SECURITY DEFINER functions, both returning zero rows for an unknown or draft key, so the public key never enumerates anything. Final signatures live in doc 01.

```sql
-- Per request. Small, depends on now().
create function resolve_public_survey(p_key text)
returns table (
  survey_id uuid, workspace_id uuid, version_id uuid,
  state text, reason text, opens_at timestamptz, closed_message text,
  og_title text, og_description text, og_image_path text, allow_indexing boolean,
  workspace_name text, logo_path text, brand_color text, show_powered_by boolean, privacy_notice_url text,
  pixel_consent_mode pixel_consent_mode, pixels jsonb   -- enabled pixels minus excluded_pixel_ids
)
language sql stable security definer set search_path = public as $$ ... $$;

-- Cached forever by version id. Returns null unless p_version_id is the
-- published version of the survey p_key resolves to and that survey is open.
create function get_public_definition(p_version_id uuid, p_key text)
returns jsonb
language sql stable security definer set search_path = public as $$ ... $$;

revoke all on function resolve_public_survey(text), get_public_definition(uuid, text) from public;
grant execute on function resolve_public_survey(text), get_public_definition(uuid, text) to anon;
```

`pixels` is folded into `resolve_public_survey` so anon needs no third function. `get_public_definition` returns only `public_definition` (R9); the server-only half is read by route handlers with the service role.

Rendering:

```ts
// src/lib/public/load.ts
export async function loadPublicSurvey(key: string) {
  const { data: s } = await anon.rpc('resolve_public_survey', { p_key: key }).maybeSingle()
  if (!s || s.state === 'draft') return null
  if (s.state !== 'open') return { survey: s, definition: null }
  return { survey: s, definition: await getDefinition(s.version_id, key) }
}

async function getDefinition(versionId: string, key: string) {
  'use cache'
  cacheLife('max')                      // published versions are immutable
  const { data } = await anon.rpc('get_public_definition', { p_version_id: versionId, p_key: key })
  return data
}
```

- The state lookup runs on every request (one indexed query; state depends on `now()`). The definition is fetched once per version id and key.
- The page is a server component that renders branding, state screens, and the static frame, then hands the definition to the `<SurveyRenderer>` client component from doc 03.
- `generateMetadata` emits, with `metadataBase` set to `https://{PUBLIC_HOST}` (the public hostname):
  - `og:title` = `og_title` or the version title; `og:description` = `og_description` or the first 160 chars of the intro.
  - `og:image` = cover image from `public-assets` if set (1200x630 recommended, max 1 MB, JPEG/PNG/WebP), otherwise a generated card from `/api/public/og/{versionId}` (next/og, title plus workspace logo, cached forever per version).
  - `twitter:card=summary_large_image`, `og:url` = `/{key}` as requested.
  - `robots: noindex, nofollow` unless the survey sets `allow_indexing`. Unfurlers in Slack, iMessage, and WhatsApp ignore `noindex`, so previews still work.

---

## 5. Submission route handler

`POST /api/public/submit`, on `PUBLIC_HOST` only. Body limit 256 KB.

```ts
type SubmitRequest = {
  action: 'save' | 'complete'
  surveyId: string
  versionId: string               // the version the respondent loaded
  idempotencyKey: string          // uuid v4
  resumeToken?: string            // present after first save
  respondentToken?: string        // ?t= personalized link token
  answers: Record<string, unknown> // keyed by question_key
  hidden: Record<string, string>   // URL params captured at load, sanitized
  uploadIds: string[]
  startedAt: string
  turnstileToken?: string
  website: string                 // honeypot, must be ''
}
```

### 5.1 Order of checks

1. Parse with zod. Bad shape: 400.
2. Honeypot. A non-empty `website` (visually hidden input, `tabindex=-1`, `autocomplete=off`, `aria-hidden`) returns a fake `200 { ok: true }` and writes nothing, so bots learn nothing.
3. Rate limit (5.2). Done before Turnstile so floods cost one Postgres call each.
4. Turnstile, required when the request **creates** a response (no `resumeToken`) and on `complete`. Plain saves carrying a valid resume token skip it. Server verify:
   ```ts
   const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
     method: 'POST',
     body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip, idempotency_key: body.idempotencyKey }),
   }).then((r) => r.json())
   if (!r.success || r.action !== 'submit' || r.hostname !== PUBLIC_HOST) return err(403, 'captcha_failed')
   ```
5. Validate with `validateSubmission(definition, answers, { mode })` from `src/lib/survey/validate.ts` (doc 03, R4). The handler loads the full version with the service role and maps `save` to `partial` (types and limits only) and `complete` to `final` (also required fields and logic-visible paths). Answers to hidden-by-logic questions are dropped, not rejected.
6. Call `submit_response` with the service role. It is the only writer and does every race-sensitive check under row locks.

The loaded version is accepted even if the survey republished mid-fill; versions are immutable.

### 5.2 Postgres rate limiting

Sliding-window log in an unlogged table (losing it on crash is fine, it is cheaper to write).

```sql
create unlogged table rate_limit_events (
  bucket text not null,
  key    text not null,
  at     timestamptz not null default now()
);
create index on rate_limit_events (bucket, key, at desc);

create function rate_limit_hit(p_bucket text, p_key text, p_window interval, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_key, 0));
  select count(*) into n from rate_limit_events
   where bucket = p_bucket and key = p_key and at > now() - p_window;
  if n >= p_max then return false; end if;
  insert into rate_limit_events (bucket, key) values (p_bucket, p_key);
  return true;
end $$;
revoke all on function rate_limit_hit from public, anon, authenticated;  -- service role only
```

IP hash: `HMAC-SHA256(ip, RATE_LIMIT_SECRET + utcDate)`, truncated to 16 bytes, hex. The raw IP is never stored here (the workspace "store IP" setting, off by default, governs `responses.metadata` only). IP comes from the first `x-forwarded-for` entry, which Vercel sets.

| Bucket | Key | Window | Max |
|---|---|---|---|
| `submit:create` | ip hash | 10 min | 10 |
| `submit:save` | ip hash | 1 min | 60 |
| `submit:complete` | ip hash + survey id | 1 hour | 20, or the value from `effective_limits(workspace_id)` |
| `submit:survey` | survey id | 1 min | 600 |
| `upload:mint` | ip hash | 10 min | 30 |

Exceeding returns `429` with `Retry-After`.

Pruning runs in pg_cron (R3), pure SQL:

```sql
select cron.schedule('prune-rate-limit', '*/15 * * * *',
  $$delete from rate_limit_events where at < now() - interval '2 hours'$$);
select cron.schedule('prune-idempotency', '17 * * * *',
  $$delete from submission_idempotency where created_at < now() - interval '24 hours'$$);
select cron.schedule('prune-retired-aliases', '23 3 * * *',
  $$delete from survey_aliases where retired_at < now() - interval '30 days'$$);
```

### 5.3 Caps, tokens, resume, idempotency

`submit_response` contract (body lives in doc 01):

```sql
submit_response(
  p_survey_id uuid, p_version_id uuid, p_action text, p_idempotency_key uuid,
  p_resume_token_hash bytea, p_respondent_token text, p_answers jsonb, p_metadata jsonb,
  p_upload_ids uuid[], p_started_at timestamptz
) returns jsonb  -- { ok, code?, response_id, resume_token?, score? }
```

Inside one transaction:

- **Idempotency.** `insert into submission_idempotency (key, survey_id) on conflict do nothing`; if the key existed, return its stored `result` unchanged. The client generates one key per save/complete attempt and reuses it on retry after a network error. Rows are pruned after 24 hours. Completing an already-complete response also returns the stored result.
- **Response cap (the only cap, R10).** On `complete`: `update surveys set complete_count = complete_count + 1 where id = p_survey_id and (response_cap is null or complete_count < response_cap) returning id`. Zero rows: `cap_reached`, and the renderer shows the closed message. State is not changed.
- **Personalized token.** `select ... from respondent_tokens where token = p_respondent_token for update`. Unknown: `token_invalid`. Complete responses for the token `>= max_responses`: `token_used`. A token's open partial is resumed instead of creating a second one, so the personalized link doubles as the resume key.
- **Uploads.** Flips the response's `response_files` rows from `pending` to `attached` (section 6) and checks their stored size and MIME against `storage.objects.metadata`.
- **State.** Re-checks `survey_effective_state` (plus the 15-minute grace) under the survey row lock.

**Resume decision: localStorage first, URL on request.** The first save returns a 32-byte random resume token; only its SHA-256 is stored on the response. The client keeps it in `localStorage` under `survey:{surveyId}:resume`, so returning on the same device resumes automatically. A "Save and continue later" button reveals `https://{PUBLIC_HOST}/{key}?r={token}` to copy (we send no email). On load with `?r=`, the client posts it to `POST /api/public/resume` (body, never a GET query, to keep it out of logs) and gets saved answers back. Before any pixel loads, the client strips `r` and `t` from the address bar with `history.replaceState` so neither leaks into analytics page URLs or referrers. Tokens die on completion or after 30 days.

### 5.4 Responses the renderer shows

```ts
type SubmitResult =
  | { ok: true; responseId: string; resumeToken?: string; score?: { value: number; max: number } }
  | { ok: false; code: ErrorCode; fieldErrors?: Record<string, string>; retryAfter?: number }
```

| Code | HTTP | Renderer shows |
|---|---|---|
| `invalid_request` | 400 | "Something went wrong. Please refresh and try again." |
| `captcha_failed` | 403 | Re-runs Turnstile, then "Please confirm you are human." |
| `token_invalid` | 403 | "This personal link is not valid." |
| `not_found` | 404 | Generic 404 screen |
| `survey_closed` / `not_open_yet` / `cap_reached` | 409 | Swaps to the closed or scheduled screen. Answers stay in localStorage. |
| `token_used` | 409 | "You have already responded with this link." |
| `validation_failed` | 422 | Inline errors by `question_key`, focus moves to the first |
| `rate_limited` | 429 | "Too many attempts. Try again in {n} seconds." Autosave backs off silently. |
| `server_error` | 500 | "We could not save your response. Your answers are kept on this device." Retry button reuses the idempotency key. |

---

## 6. File uploads from anonymous respondents

Bucket `responses`, private, `allowed_mime_types` set to the global allowlist: `image/jpeg, image/png, image/webp, image/heic, application/pdf, text/plain, text/csv`, plus the Office document types. SVG and HTML are never allowed (stored XSS).

Limits (R13): max file size and max files per response come from `effective_limits(workspace_id)` (doc 01), which merges `workspace_limits` overrides over the globals in 00 (25 MB, 20 files). Questions may narrow both size and types, never widen. The bucket's `file_size_limit` is the hard ceiling an override may reach (100 MB); the effective limit is checked at mint and again in `submit_response` against the real object size.

```sql
-- One table for every uploaded file: a row starts 'pending' at mint and becomes
-- 'attached' when submit_response links it to a response. Final DDL in doc 01.
create table response_files (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  survey_id     uuid not null references surveys(id) on delete cascade,
  question_key  text not null,
  response_id   uuid references responses(id) on delete cascade,
  object_path   text not null,
  declared_size bigint not null,
  declared_mime text not null,
  original_name text not null,
  status        text not null default 'pending' check (status in ('pending','attached')),
  created_at    timestamptz not null default now()
);
```

Flow:

1. Respondent picks a file. Client calls `POST /api/public/uploads` with `{ surveyId, versionId, questionKey, name, size, mime, resumeToken?, turnstileToken? }`. Either a valid resume token or a fresh Turnstile token is required, plus the `upload:mint` rate limit and the files-per-response limit.
2. Handler checks the question is a file question in that version and the size and MIME fit the effective limits, inserts a `response_files` row in state `pending`, and mints `createSignedUploadUrl` for `{workspace_id}/{survey_id}/pending/{upload_id}/{safe_name}` (2-hour validity).
3. Client uploads directly to Storage with `uploadToSignedUrl`, shows progress, and puts the `upload_id` in the answer.
4. On save or complete, `submit_response` attaches each id (same survey, `response_id` null or equal) and verifies the real object's size and mimetype. Afterward, the handler moves each object to `{workspace_id}/{survey_id}/{response_id}/{upload_id}-{safe_name}` and updates `object_path`. A failed move leaves the old path valid; the sweep retries.

Cleanup (Vercel Cron hourly, `/api/cron/orphan-uploads`, because it calls the Storage API): `response_files` rows still `pending` after 24 hours are removed from Storage and deleted, and queued `storage_deletions` paths are processed. Deleting a response (respondent deletion, retention in doc 04) cascades its rows and enqueues object paths there. SQL never deletes from `storage.objects` directly, because that skips the underlying file.

Member downloads: Storage RLS on `storage.objects` allows `select` for authenticated users when `bucket_id = 'responses' and is_member(((storage.foldername(name))[1])::uuid, 'viewer')`. The dashboard mints 60-second signed URLs with the member's own client, always with the `download` option so the browser saves rather than renders.

---

## 7. Tracking pixels and analytics tags

```sql
create type pixel_type as enum ('ga4','meta','gtm','custom_script');
create table workspace_pixels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  type          pixel_type not null,
  value         text not null check (
                  (type = 'ga4'  and value ~ '^G-[A-Z0-9]{4,12}$') or
                  (type = 'meta' and value ~ '^[0-9]{8,20}$') or
                  (type = 'gtm'  and value ~ '^GTM-[A-Z0-9]{4,10}$') or
                  (type = 'custom_script' and length(value) <= 10000)),
  label         text not null,
  enabled       boolean not null default true,
  created_by    uuid, created_at timestamptz not null default now()
);
alter table surveys add column excluded_pixel_ids uuid[] not null default '{}';
```

No count limit per workspace. **Per-survey opt-out decision: `excluded_pixel_ids uuid[]` on `surveys`.** It loads with the survey row in one read, lists are tiny, and a stale id after a pixel is deleted is harmless. Owner and admin manage pixels; only they may create `custom_script` or `gtm`, and the form shows: "This code runs on every public survey in this workspace with full access to the page, including what respondents type. Only paste code from a vendor you trust."

`custom_script` accepts only `<script>` (inline or `src`) and `<noscript>` elements; anything else is rejected at save. The server parses it into parts once at save time and stores the parsed form next to `value`.

Public pages get pixels from the `pixels` column of `resolve_public_survey` (section 4): enabled pixels minus exclusions.

**Injection.** `src/components/public/pixels/` holds `<Ga4>`, `<MetaPixel>`, `<Gtm>`, `<CustomScript>`, each built on `next/script` with `strategy="afterInteractive"` and the request nonce. They are rendered only from `src/app/(public)/layout.tsx`. An ESLint `no-restricted-imports` rule forbids importing that folder from anywhere under `(app)`, and the dashboard CSP would refuse them anyway.

### 7.1 Content Security Policy

All CSP is set in `proxy.ts`, one header per response, chosen by hostname (section 1), so two policies never intersect by accident. `next.config.ts` keeps the other security headers from 559flawless (HSTS, nosniff, Referrer-Policy, Permissions-Policy).

**Public hostname: nonce plus `strict-dynamic`.** Next 16 reads the nonce from the request CSP header and stamps its own scripts; pixel components pass it explicitly. Scripts loaded by a nonced script are trusted, which is what GTM and vendor loaders need.

```
default-src 'self';
script-src 'self' 'nonce-{n}' 'strict-dynamic' https:;   -- https: is ignored by browsers that support strict-dynamic
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
connect-src 'self' https: wss://*.supabase.co;
frame-src https://challenges.cloudflare.com https://www.googletagmanager.com https:;
font-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'none';
object-src 'none'
```

`https:` for images, connect, and frames because GTM and raw snippets beacon to arbitrary vendors. Script execution stays nonce gated, so markup injected through survey content cannot run.

**Dashboard hostname, including builder preview:** no third-party scripts at all. `script-src 'self' 'nonce-{n}'`, `connect-src 'self' https://*.supabase.co wss://*.supabase.co`, `frame-src https://challenges.cloudflare.com` (only if sign-in uses Turnstile), `frame-ancestors 'none'`.

### 7.2 Consent

Workspace setting `pixel_consent_mode` (R7), enum `banner | notice | in_form`, default `banner`. In every mode, a survey whose resolved `pixels` list is empty shows no consent UI and loads nothing.

| Mode | Public shell renders | Pixels load |
|---|---|---|
| `banner` | Opt-in banner, Accept and Decline with equal weight, link to the privacy notice. Choice stored in localStorage as `survey:consent:{workspaceId}`. | Only after Accept. GA4 and GTM start with Google Consent Mode v2 defaults `denied` and flip to `granted` on Accept. Decline loads nothing. |
| `notice` | Informational banner ("This survey uses analytics tools." plus privacy link), dismiss only. Selecting this mode requires an owner or admin to tick an acknowledgment that the workspace is responsible for consent; stored with who and when. | Immediately, consent defaults `granted`. |
| `in_form` | No banner. | Only after the respondent checks a consent block with `gates_tracking: true` (doc 03 block option). A survey without such a block loads no pixels. Consent Mode defaults `denied` until checked. |

Unchecking or withdrawing does not unload scripts already loaded; it stops further custom events and sets Consent Mode back to `denied`.

### 7.3 Event mapping

No answer values or identity fields are ever sent to a pixel.

| Survey event | GA4 | Meta | GTM `dataLayer` | Custom script |
|---|---|---|---|---|
| Page loaded | `page_view` (auto) | `PageView` | `{event:'survey_view'}` | `window` event `survey:view` |
| First answer | `survey_start` | `trackCustom('SurveyStart')` | `survey_start` | `survey:start` |
| Step change | `survey_step` `{step}` | none | `survey_step` | `survey:step` |
| Completion (after server ok) | `survey_complete` | `Lead` | `survey_complete` | `survey:complete` |

Every event carries `survey_id` and `survey_key`. On completion the client waits for the pixel callbacks or 500 ms, whichever comes first, before any thank-you redirect. Our own first-party analytics events are separate (doc 04).

---

## 8. QR codes

- Library: `qrcode` npm, generated in the browser on the survey Share panel. SVG via `QRCode.toString(url, { type: 'svg' })`, PNG via `QRCode.toCanvas` then `canvas.toBlob`.
- Encoded URL: always `https://{PUBLIC_HOST}/{key}` on the public hostname, using the live alias if set, else the slug. Toggle "Tag scans" (on by default) appends `?utm_medium=qr`.
- Error correction: `M` without a logo, `H` with a logo. Quiet zone 4 modules.
- Sizes: SVG (scalable, for print), PNG 512, 1024, 2048 px.
- Logo rules: the logo box including its white padding covers at most 20 percent of the symbol area (side at most 0.447 of the symbol width); default box side 0.30. White padding of at least one module on all sides, rounded corners, logo scaled to fit inside preserving aspect ratio, centered. After rendering, the panel decodes the PNG with `jsqr`; if it fails, the logo shrinks in 10 percent steps until it decodes, and the panel says so.
- Logo storage: `public-assets/{workspace_id}/logo.{png|svg|webp}`, public bucket (the logo is shown on public pages anyway, and public URLs carry CORS headers so the canvas is not tainted). In SVG output the logo is embedded as a base64 `data:` image so the file is self-contained.
- Caching: none server side; generation takes milliseconds. The client memoizes by `url + logoHash + options`.
- Download UX: preview, logo toggle (disabled with a hint if no logo), format, size, the encoded URL printed under the preview with a copy button, file name `{key}-qr.{ext}`. When the code encodes an alias, a note says printed codes stop working 30 days after a rename and offers "Use permanent link" (the slug) for print.

---

## 9. Public footer

Rendered by the public layout on every public screen: survey, scheduled, closed, thank you, and the 404. The privacy page shows it too.

```tsx
<footer className="public-footer">
  <nav aria-label="Survey links">
    <a href="/privacy">Privacy notice</a>
    {survey.privacy_notice_url && (
      <a href={survey.privacy_notice_url} target="_blank" rel="noopener noreferrer">
        {survey.workspace_name} privacy notice<span className="sr-only"> (opens in a new tab)</span>
      </a>
    )}
  </nav>
  {survey.show_powered_by && <p className="powered-by">Powered by Survey</p>}
</footer>
```

- **Privacy notice** (always): `/privacy` on `PUBLIC_HOST`, the organization notice a platform admin edits (doc 05). The workspace's `privacy_notice_url` (https only, validated at save) is added when set. Both open in a new tab while a survey is in progress so a click never loses progress.
- **Powered by Survey**: plain text, no link (there is no marketing site). `workspaces.show_powered_by` is a plain workspace toggle (default true, owner or admin). Nothing gates it.

All values come from `resolve_public_survey`. Real text, AA contrast, after the form in tab order.

### 9.1 Report abuse

Removed by R21: there is no public report form, route or `abuse_reports` table.

---

## 10. Thank-you screen

Shown in place (same URL, no separate route) after `{ ok: true }`. Configured per ending in the version definition (doc 03 owns the schema; endings may vary by logic):

- `message`: limited markdown (bold, italic, links, line breaks), sanitized at render. Links must be `https:` or `mailto:`.
- `redirect_url`: optional. Validated at publish and again at render with `new URL()`; only `https:` is allowed (no `http:`, `javascript:`, `data:`). Optional `redirect_delay_seconds` 0 to 10 with a visible countdown and a "Continue" link; with 0 the message still flashes for the pixel flush. Optional "pass hidden fields" appends the captured hidden fields as query params.
- `show_score`: renders the `score` returned by `submit_response`. Never computed client side.
- `show_summary`: lists the respondent's own answers from client state (not refetched; file answers show file names only).

---

## 11. Public page baseline

- **Mobile first**: 360 px, single column, 44 px tap targets, 16 px inputs.
- **Accessibility**: every question is a `fieldset` with `legend`; errors are linked by `aria-describedby` and announced in an `aria-live="polite"` region; on step change focus moves to the step heading; full keyboard operation; `prefers-reduced-motion` honored. Brand colors are checked for 4.5:1 text contrast and the text color is flipped automatically when they fail. Target WCAG 2.2 AA.
- **Progress**: "Step 2 of 5" text plus `role="progressbar"` with `aria-valuenow`. With branching, the total is the longest remaining path, so the bar never moves backward.
- **Autosave**: `save` 1.5 s after the last change, on step change, and on `visibilitychange` to hidden (`navigator.sendBeacon` with a JSON Blob). Answers also mirror to localStorage so a failed save loses nothing.
- **Fonts**: `next/font` self-hosted, `display: swap`. Workspace font choice is limited to a self-hosted set. No runtime Google Fonts requests.
- **Turnstile** loads async in managed mode and never blocks render. One widget, registered for `PUBLIC_HOST` only (R14). Pixels load after interactive.
- **Budget** (enforced in CI with a bundle check and Lighthouse on a fixture survey): first-load JS for the public route at most 120 KB gzipped excluding pixels; LCP under 2.0 s and CLS under 0.05 on a mid-range Android over 4G; INP under 200 ms; server response under 400 ms p75.

---

## Decisions made here

- **Two fixed hostnames, route group picked by hostname in `proxy.ts` (R15).** Public pages run on an origin with no member session; the dashboard host 302s `/s/{key}` so pasted links never 404.
- **Auth cookies host-only to the dashboard; builder preview there with pixels disabled.** No workspace script ever shares an origin with a session.
- **Public reads only through `resolve_public_survey` and `get_public_definition`, pixels folded into the first.** Anon has no table grants and exactly two functions.
- **State per request, definition cached forever by version id.** State depends on the clock; versions are immutable.
- **Aliases: one global namespace, one live alias per survey, 30-day hold on retirement.** The hold stops link hijacking; the slug is the permanent fallback.
- **Effective state in SQL, 15-minute grace for scheduled closes only.** No cron; the clock does not punish a respondent mid-form.
- **Cap reached shows the closed message, state untouched.** Raising the cap reopens without a second edit.
- **Turnstile on response creation and completion only.** Autosaves stay frictionless.
- **Resume via localStorage, copyable `?r=` link on request, stripped before pixels load.** No email, no token leaks to analytics.
- **Unlogged sliding-window rate-limit table, daily-salted HMAC IP hash.** Fits "no Redis", keeps raw IPs out.
- **pg_cron prunes rate limits, idempotency keys, and retired aliases; Vercel Cron only runs the orphan upload sweep (plus doc 04 retention).** SQL jobs stay in SQL; Storage deletes need the API.
- **Upload and rate limits from `effective_limits(workspace_id)`; bucket ceiling 100 MB.** Overrides work without changing bucket config.
- **Uploads to a pending path, moved under the response id after attach.** Per-response layout without needing a response first.
- **`excluded_pixel_ids uuid[]` on surveys.** One read, tiny lists, stale ids harmless.
- **`pixel_consent_mode` with three modes, `banner` default.** Opt-in is the safe default; `in_form` is the old `gates_tracking` design.
- **QR always encodes the single domain URL, with a permanent-link option for print.** Aliases can lapse after rename; slugs cannot.
- **Footer always links the organization privacy notice and the workspace notice when set; "Powered by" is plain text behind `show_powered_by`.** The Report abuse link was removed by R21.
- **Public pages `frame-ancestors 'none'` in v1.** Embedding is not in scope yet.

## Open questions for the owner

1. **Second hostname (R15).** Resolved by 00. If the owner rejects it, the fallback is to drop the `custom_script` and `gtm` pixel types and keep GA4 and Meta only.
2. **Consent default.** Is `banner` the right default for `pixel_consent_mode` (R7 asks you to confirm)?
3. **Embeds.** Should surveys be embeddable in other internal sites by iframe? That changes `frame-ancestors` per workspace.
4. **Meta completion event.** Is `Lead` right, or should the event name be configurable per pixel?
5. **Upload ceiling.** Is 100 MB the right hard ceiling for platform admin overrides?
6. **Default indexing.** Surveys default to `noindex`. Should any be searchable?
