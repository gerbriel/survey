# 07. Security review, 2026-10-21

Merged from four read-only reviews of commit 4ab1744 (Phase 2) plus migration 0018: `docs/security/review-sql.md`, `review-public.md`, `review-dashboard.md`, `review-fable-notes.md`. Those files hold the full evidence, exploit scenarios and SQL or code sketches. This document ranks, deduplicates, rules, and tracks fix status. Rulings R16 to R18 in `00-decisions.md` came out of this review.

Totals across the four sources before dedup: 0 Critical, 4 High, 10 Medium, 30 Low, 20 Info. After dedup the High and Medium set is 12 items, listed first.

## Ranked findings and rulings

| # | Severity | Finding | Sources | Ruling | Owner |
|---|---|---|---|---|---|
| S1 | High | Invite-only gate bypass: a password signup with an unverified email that matches an open platform invite is activated | D-01, SQL H-1 | R18. Email-match claiming only when the provider reports the email verified; password signups need a token link. Keep `enable_confirmations` off. | I3-SQL, I3-APP |
| S2 | High | Per-survey shared rate bucket counted before per-IP and Turnstile; one anonymous client makes every respondent get 429 | public H1, SQL M-2 | R17. Order: per-IP, Turnstile, then per-survey; per-survey bucket counts validated requests only. | I3-APP |
| S3 | High | Shared public origin: one workspace's custom_script or GTM reads other workspaces' in-progress answers and resume tokens from localStorage and forges consent | public H2, SQL L-1, public I1 | R16. Kill switch covers custom_script and GTM, default off, platform admin enables per workspace with a warning. No answers in browser storage. Kill switch enforced by pixel type at render, never by parsed content. Per-workspace subdomains are v2. | I3-APP, I3-SQL |
| S4 | Medium | Plaintext resume secret stored in `submission_idempotency.result` and returned on key replay (the key also goes to Turnstile) | SQL M-1, public L2 | Store the result without the secret; replay returns `replayed: true` and no secret. Handler returns the secret only on first save. | I3-SQL, I3-APP |
| S5 | Medium | `reports.survey_id` can be repointed at another workspace's survey, blocking their default report | SQL M-3 | WITH CHECK that the survey belongs to the row's workspace; `survey_id` immutable after insert. | I3-SQL |
| S6 | Medium | Platform admin mints a password reset link for anyone, including other admins and self; audit written after and fails open | D-02 | R18. Refuse platform admins and self; write the audit row first and abort if it fails; log the target, never the link. | I3-APP |
| S7 | Medium | Workspace admins can read owner-created admin-role invite links; invite and share tokens are copied into `activity_log.diff` for 400 days | D-03, D-08, SQL L-2 | Invite select policy: creator, owner, or invites whose role is at or below the caller's role. `log_activity` scrubs `token` and `password_hash` columns. | I3-SQL |
| S8 | Medium | Contact CSV export and personalized link CSV write no activity row | D-04 | Route through `log_export` (kinds `contacts`, `links`). | I2 (in progress), verify in I3-APP |
| S9 | Medium | IP-keyed limits: NAT'd internal respondents throttled together; IPv6 rotation defeats every limit; first `x-forwarded-for` entry trusted | public M1, public I2, Fable F1 | R17. Platform header first, last XFF entry otherwise; IPv6 keyed by /64; create limit at least 60 per 10 minutes per IP; key `submit:create` by IP plus survey; one `clientIp()` used everywhere. | I3-APP |
| S10 | Medium | Uploads unbounded: `create_upload` does not count pending files per response; stored object size not bound to the declared size; cron routes not scheduled (no `vercel.json`) | public M2, public L1, public I5 | `create_upload` counts pending plus attached against 20 and rejects; bucket `file_size_limit` set to the largest allowed per-file size; attach verifies the Storage object size against the declared size. Add `vercel.json` now. | I3-SQL, I3-APP |
| S11 | Medium | Events beacon limited only by a client-chosen rid | public M3 | Add a per-IP bucket and a per-survey ceiling. | I3-APP |
| S12 | Medium (PLAUSIBLE) | Auth cookies lack the `__Host-` prefix, so a script on the public host could plant a cookie the dashboard host reads | public M4 | Use a `__Host-` prefixed cookie name in production if `@supabase/ssr` cookie options allow it; otherwise document and rely on the proxy host check. | I3-APP |

## Low and Info items folded into the fix pass

Cheap to fix now, so they ride along:

- **SQL (I3-SQL):** L-5 immutability guards (`contact_notes`, `contact_field_defs`, `contact_views.shared`, `reports.created_by`, `pixel_notice_ack_by`); L-6 `contact_imports.storage_path` must start with the workspace prefix; L-8 and D-13 stop publishing DELETE on `responses` (publish insert and update only); L-9 prune rate limit rows to the largest window; L-10 stale lock takeover bumps `revision` and `save_draft` locks the row; L-13 response deletes go through a function that logs and adjusts `complete_count`; D-07 invite token and expiry generated server side by the guard trigger, never client supplied; L-3 and D-12 share passwords hashed with `hash_share_password` (bcrypt), client-written hashes rejected; I6 shared report min and max suppressed when the cell count is under 3; L-12 salt the erasure email hash.
- **App (I3-APP):** D-05 row-level export becomes POST; D-06 CSV guard covers leading whitespace, tab, carriage return and the semicolon delimiter; D-14 never return raw SQL error detail to the browser, map through `DbError`; L7 OG route checks survey state, is rate limited, and does not cache null results forever; L8 Turnstile test secrets rejected in production; I7 enforce the 64 KB beacon cap before reading the body; I8 hidden field keys pattern checked on the server; D-17 and SQL I-5 `logo_path` and `og_image_path` validated as object names, `publicAssetUrl` rejects absolute URLs; D-18 small hardening (Content-Length required on logo upload, password minimum 8 enforced in Supabase config, escape `_` and `%` in lookup `ilike`); public L4 piped values URL-encoded inside link hrefs and `safeHref` rejects userinfo; public L5 theme colors validated as hex in `migrate.ts`; I4 `REPORT_SHARE_SECRET` added to `.env.example` and required in production (no fallback to the service role key); D-15 add an `assertBelongsToWorkspace(slug, surveyId)` helper and use it on survey, response, contact and report pages so a wrong-workspace id 404s before any query.

The two renderer and survey-core items (L4, L5) are foundation edits. I3-APP may make them with a unit test each; they are listed here as the authorization.

## Accepted for v1, revisit in v2

- SQL I-3: anon read path has no SQL-level throttle and aliases can be dictionary-enumerated. Turnstile does not guard reads. Accept; aliases are chosen by editors and surveys are meant to be shared.
- SQL I-2 and D-16: invite, respondent and share tokens stored in plaintext; invite token carried in signup metadata. Resume tokens are hashed. Accept for an internal tool; hashing the rest is a v2 item.
- SQL L-4: `validate_contact_custom` and `workspace_slug_available` are callable by any active profile and leak existence of a slug or field key. Accept; low value oracles.
- SQL L-7: no test pins what `authenticated` may execute. Add the test in Phase 3B rather than change grants now.
- SQL L-11: `contact_duplicate_candidates` is quadratic and callable by viewers. Accept with the 20,000 response cap already in analytics; add a row cap in v2.
- D-09: a demoted export creator can still fetch signed URLs for their own past jobs until they expire. Accept; URLs expire.
- D-10: no rate limits on authenticated abuse surfaces (invite creation, token link generation, import chunks, share creation). Accept for an invite-only internal user base; `workspace_limits` bounds the expensive ones.
- Fable F2: rate limiter fails open on database error. Accept; Turnstile is the primary gate. Revisit if the database is ever the bottleneck.
- public L3: a save carrying only `?t=` rotates the partial's resume hash. Low impact; fix in v2 by binding the resume token to the token link.
- public L6: `?r=` and `?t=` remain in the flight payload and edge logs after `replaceState`. Accept; logs are ours, and pixels load after the strip.
- SQL I-1, I-4, I-6, I-7, public I3, D-11: informational; I2's wiring of the `admin_*` audited functions resolves D-11.

## What held up

Every reviewer listed areas that were sound. The combined list: no dynamic SQL anywhere in 18 migrations; every SECURITY DEFINER function sets `search_path`; all 40 tables have RLS; anon can execute exactly two functions and has no table access; response cap, token use and invite use counters are race safe under row locks; no path lets a user grant themselves a role or the platform admin flag; every service-role call site in `src/lib` is preceded by a platform admin check, a verified membership, or the cron secret; the auth callback `next` handling and cookie flags (HttpOnly, Secure, SameSite Lax, no Domain) are correct; the CSP nonce is generated per request and propagated; no `dangerouslySetInnerHTML`; survey content, piped answers and markdown render as text; redirect URLs are scheme checked; cron secrets are compared in constant time and required; Turnstile is enforced in production.

## Fix plan

Two agents after integration I2 commits, in parallel on disjoint files:

- **I3-SQL:** migration `0019_security_review.sql` with the S1, S3 (kill switch default and GTM), S4, S5, S7, S10 changes and the SQL Low items above; `supabase/tests/10_security_review.sql` asserting each; regenerate `src/types/database.ts`; keep function signatures compatible where possible and list any that change.
- **I3-APP:** everything in the app column plus the Low list for App; unit tests for each behavior change; `vercel.json` with the three cron schedules.

Then Fable runs the gates, commits, and updates the status column below. Phase 3B re-verifies every High and Medium against the running stack.

## Status

| # | Status |
|---|---|
| S1 to S12 | Open, assigned 2026-10-21 |
