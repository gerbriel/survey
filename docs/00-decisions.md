# 00. Cross-cutting decisions

Source of truth for every other doc in this folder. If a later doc contradicts this one, this one wins until it is edited here.

Written 2026-10-21. Revised the same day after a scope change: this is an **internal tool**, not a sellable product. Working name: **Survey** (placeholder).

## What we are building

A multi-workspace survey and form builder for the owner's own organization. Workspaces are departments or teams. Signed-in users (invite only) build surveys with the feature depth of Jotform and SurveyMonkey paid tiers. Each survey has a public URL that anyone can fill out without an account. Responses feed reports, analytics, and a lightweight CRM that tracks the same respondent across many surveys.

Out of scope for good: booking/scheduling, outbound email of any kind (no provider, no blasts, no notification emails), payments collected inside surveys, billing or plans of any kind, per-workspace custom domains.

## Facts fixed by the owner

- Multi-workspace, like departments. A workspace owns surveys, contacts, members, settings, pixels, logo.
- Internal tool. No plans, no Stripe, no usage metering, no marketing or pricing pages. Anything that only existed to sell the product is gone. (Reversed on 2026-10-21 from an earlier "sellable product" decision.)
- Invite only to become a signed-in user. Public survey links are open to the world.
- No email provider. Invites, notifications, and lead follow-up never send email from the app.
  - Auth consequence: Google OAuth is the primary sign-in. Email/password is allowed but password reset depends on Supabase auth SMTP, which is rate limited on the default sender. Treat email/password as secondary. Invites are shareable links with tokens, never emailed by us. A platform admin can mint a password reset link for a user by hand.
- Every survey gets a unique URL and an optional QR code. If the workspace has uploaded a logo, the QR can embed it in the center.
- A "Powered by Survey" footer appears on public surveys by default. It is a workspace toggle, nothing gates it.
- **One organization domain, no per-workspace custom domains.** Every workspace's public survey links live on the same fixed hostname. (Reversed on 2026-10-21 from an earlier custom-domain decision.) For a security reason explained in R15, the dashboard and the public survey pages are served from two fixed hostnames of that one domain, both pointing at the same deployment: `survey.example.org` for the dashboard and `s.example.org` for public pages (placeholders). Owner to confirm, see R15.
- Workspace-level tracking pixels and analytics tags (GA4, Meta Pixel, Google Tag Manager, raw script snippet). Applied to all the workspace's public surveys automatically. Each survey can deselect any of them.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict | Server routes for captcha verification, rate limiting, signed uploads, and per-survey link previews. 559flawless already uses this stack; reuse its conventions. With custom domains gone this is a preference, not a requirement, but nothing is gained by switching. |
| Styling | Tailwind v4 | Matches the reference apps. |
| Data | Supabase: Postgres with RLS, Auth, Storage | Matches all three reference apps. All authorization lives in RLS and SQL functions. Route guards are UX only. |
| Hosting | Vercel | Simplest fit for Next.js. Any Node host works. |
| Bot protection | Cloudflare Turnstile | Free, privacy friendly, verified server side. One widget, one hostname. |
| QR | `qrcode` npm package rendering to canvas/SVG, logo overlaid client side, error correction level H when a logo is present | No vendor. |

No Redis, no queue, no email vendor, no payment processor. Rate limiting is Postgres based.

## Tenancy and authorization

- `workspaces` is the tenant root. Every tenant table carries `workspace_id` and an RLS policy that checks membership.
- `workspace_members(workspace_id, user_id, role)` with roles `owner`, `admin`, `editor`, `viewer`. Exactly one owner per workspace. Owner and admin manage members, pixels, branding, privacy. Editor creates and edits surveys and manages contacts. Viewer reads surveys, responses, reports.
- Survey-level overrides are not in v1. Roles are workspace wide.
- A SQL helper `is_member(workspace_id, min_role)` (SECURITY DEFINER, STABLE) backs every policy. Role ordering: viewer < editor < admin < owner.
- Platform gate (invite only): `profiles.status` is `active` or `pending`. A signup trigger activates the profile when the email matches an unclaimed `platform_invites` row, or when the user arrives through a valid workspace invite link. Pattern comes from Fresno Skillshare migrations 00001, 00012, 00017 in `../barter-fresno/supabase/migrations/`.
- Platform admin: `profiles.is_platform_admin`. Platform admins issue platform invites, create workspaces for departments, see every workspace, and mint password reset links. They do not read workspace data unless they are also members.
- Workspace invites: `workspace_invites(workspace_id, token, role, created_by, expires_at, max_uses, used_count, revoked_at)`. The inviter copies the link and shares it however they like. Accepting a workspace invite also satisfies the platform gate.

## Public pages

- URL shape: `https://s.example.org/{slug}`. Vanity aliases share the same path: `https://s.example.org/{alias}`. The dashboard hostname also answers `/s/{slug}` with a 302 to the public hostname so a pasted link never 404s.
- `slug` is a random, lowercase, URL-safe, 10-character string (`[a-z0-9]{10}`). Never sequential. Aliases are unique across the whole deployment and are held for 30 days after a rename so printed links keep working.
- Survey states: `draft`, `open`, `closed`, `scheduled` (opens and/or closes at timestamps, computed in SQL, no cron). Only `open` accepts responses. Closed surveys show a configurable closed message.
- The anon role has no table grants at all. It may call exactly two SECURITY DEFINER functions: `resolve_public_survey(key)` for state, branding, OG fields and the published version id, and `get_public_definition(version_id, key)` for the browser-safe half of a published definition. Both return nothing for an unknown slug or alias, so holding the public Supabase key never lets anyone enumerate surveys.
- Public submission goes through a Next.js route handler, not a direct anon insert. The handler verifies Turnstile, checks honeypot, enforces rate limits and the per-survey response cap, validates answers against the published version with the shared validator, then writes with the service role inside a single SQL function. Reason: captcha verification is server side regardless, and keeping the anon role write-free shrinks the attack surface.
- Tracking pixels are injected on the public page only, never on the app. Consent default is an opt-in banner whenever at least one pixel would load (see R7). Document the Content Security Policy consequence in doc 02.
- The dashboard lives under `/w/{workspace-slug}/...` on the dashboard hostname. `proxy.ts` routes by hostname: the public hostname serves only public survey routes and `/api/public/*`; the dashboard hostname serves everything else. Auth cookies are set for the dashboard hostname only.

## Survey definitions and versioning

- A survey has many `survey_versions`. Editing happens on a draft version. Publishing freezes the version (immutable JSON definition plus a normalized `questions` snapshot) and creates a new draft copy for further edits.
- Every response references the `survey_version_id` it was answered against.
- Reports default to the latest published version and can be filtered by version. Questions carry a stable `question_key` that survives across versions so a report can span versions when a question is unchanged.
- Drafts carry a `revision` counter for optimistic concurrency and a lock (`locked_by`, `locked_at`, 15 minute expiry).
- Published versions split into `definition` (full, server only) and `public_definition` (browser safe, no quiz answers or scoring).

## Response storage

- `responses` holds one row per submission: survey, version, respondent, contact, started/submitted timestamps, status (`partial`, `complete`), metadata (hidden fields, UTM, device, optional IP).
- `answers` holds one row per question per response, typed columns (`value_text`, `value_number`, `value_date`, `value_json`) plus `question_key`.
- `responses.raw` keeps the original JSONB payload for export and for re-deriving answers if a bug is found.

## Respondent identity

Three mechanisms, all feeding one `contacts` table per workspace:

1. **Personalized links.** `respondent_tokens(survey_id, contact_id, token, max_responses)`. URL `/s/{slug}?t={token}`. The only fully reliable join.
2. **Identity question.** A survey may mark one email question (optionally phone) as the identity key. Submissions with that value upsert a contact.
3. **Hidden fields.** Any `?field=value` on the URL is captured into response metadata. `?email=` and `?contact=` may link a contact only when the survey sets `trust_hidden_identity` (default off); such contacts are badged unverified.

Contacts have a merge flow (pick survivor, move responses, keep merged ids as aliases).

## Collaboration

- No real-time co-editing in v1. A survey draft carries `locked_by` and `locked_at`. Lock expires after 15 minutes of inactivity. Another editor may take over with a warning.
- `activity_log(workspace_id, actor, entity, action, diff)` records every mutation on surveys, contacts, settings.

## Privacy

- IP addresses are not stored by default. Workspace setting to store them, off by default.
- Surveys can show a consent checkbox block with workspace-defined text. A consent block may also gate pixels when the workspace chooses the `in_form` consent mode.
- Respondent deletion: delete all responses for a contact, or anonymize responses and tombstone the contact (Fresno Skillshare pattern, migration 00004 in `../barter-fresno/supabase/migrations/`).
- Workspace data retention setting: keep forever (default) or auto-delete responses after N days.
- Public surveys link to one organization-wide privacy notice page that a platform admin edits. Every workspace may add its own notice URL on top.

## Global limits (replaces plan limits)

Fixed in config, enforced in SQL or the route handler, adjustable by a platform admin per workspace through `workspace_limits` overrides:

| Limit | Default |
|---|---|
| Max file size per upload | 25 MB |
| Max files per response | 20 |
| Max questions per survey | 300 |
| Definition JSON size | 1 MB |
| Per-survey response cap | none, set per survey |
| Rate limit per IP per survey | 20 submissions per hour |

There is no monthly response quota and no storage quota in v1. Platform admins see storage used per workspace.

## Reconciliation, 2026-10-21

Docs 01 to 05 were written in parallel against the earlier "product" scope. These rulings resolve where they disagreed and record what the scope change removed. If you find a leftover contradiction, this section wins.

- **R1. Anon read path.** Doc 01's function-only approach wins over doc 02's column-level grants. Anon gets zero table grants and two functions, `resolve_public_survey(key)` and `get_public_definition(version_id, key)`. The `x-survey-key` header idea is dropped; the key is a function argument. Doc 02's per-request state lookup plus forever-cached definition by version id is kept, each backed by one of the two functions. With one domain, the functions take no host argument.
- **R2. Vanity aliases.** Doc 02's `survey_aliases` table wins, simplified: one scope, globally unique, 30 day hold after rename. Doc 01 drops any alias column on `surveys` and adds the table to its migration plan.
- **R3. Scheduled jobs.** Two runners with a clear line. pg_cron runs pure SQL housekeeping: rate limit and idempotency pruning, activity log pruning, `event_daily` rollup. Vercel Cron (route handlers with `CRON_SECRET`) runs anything that touches Supabase Storage: response retention (deletes files) and orphan upload sweep. Doc 01 moves retention off pg_cron; doc 02 moves pruning onto pg_cron.
- **R4. Shared validator.** Name is `validateSubmission(definition, answers, context)` at `src/lib/survey/validate.ts`, owned by doc 03. Modes are doc 03's `page`, `partial`, `final`. The route handler maps its `save` action to `partial` and `complete` to `final`. Doc 03 renames; doc 02 adopts the mode names.
- **R5. Option naming.** Choice options are `{ id, label, ... }` and answers store the option **id**. The term is "option id" everywhere. Doc 03 renames "option key" to "option id". Option ids are stable across versions like question keys.
- **R6. Hidden field identity.** Survey setting `trust_hidden_identity`, default **false**. When true, `?email=` and `?contact=` may create or link a contact, the response records `identity_source = 'hidden_field'`, and the contact shows an "unverified" badge. Doc 04 changes its "default on" to default off.
- **R7. Pixel consent.** Workspace setting `pixel_consent_mode` enum: `banner` (default, opt-in banner shown only when at least one pixel would load, Google Consent Mode v2 defaults denied until accepted), `notice` (banner is informational, pixels load immediately, workspace ticks an acknowledgment of responsibility), `in_form` (pixels load only after a consent block with `gates_tracking: true` is checked). Doc 02 replaces its `pixels_require_consent` boolean with this enum. Owner should confirm the default.
- **R8. Version concurrency and templates.** `survey_versions` gains `revision int not null default 0`, incremented on every draft save; autosave and publish pass the expected revision and fail on mismatch. Lock functions are doc 01's names: `take_draft_lock(p_version_id, p_force)` and a new `release_draft_lock(p_version_id)`. `publish_survey_version(p_version_id, p_expected_revision, p_public_definition)`: the TypeScript `splitDefinition` helper runs in the publish route handler and passes the browser-safe half in; SQL verifies the revision and refuses a `p_public_definition` that still contains any server-only key. New table `survey_templates(id, workspace_id nullable, name, description, definition, created_by, created_at)`; null workspace means system template. Doc 03 renames its lock functions.
- **R9. Public definition split.** `survey_versions` gains `public_definition jsonb`, written at publish by stripping server-only fields. Doc 03 defines the server-only field list (quiz correct answers, per-option scores, scoring thresholds) and a pure `splitDefinition(definition)` helper that publish and the server validator both use. Scores are computed in `submit_response`.
- **R10. Response caps.** No monthly quota and no `workspace_usage` table. `submit_response` enforces only `surveys.response_cap` against `surveys.complete_count` (null cap means unlimited). When the cap is reached the public page shows the survey's closed message; state is not changed.
- **R11. Schema ownership.** Doc 01 is the single schema source. Tables and columns proposed in docs 02, 04 and 05 are added to doc 01's DDL and migration plan under their proposing doc's name. Other docs keep their SQL as illustration but defer to 01 on names and types.
- **R12. Removed by the scope change.** Gone from every doc: `workspace_domains`, hostname middleware, Vercel Domains API, domain states, canonical URLs across hosts, `plan_limits`, `workspace_plan_overrides`, `workspace_subscriptions`, `stripe_events`, `workspace_usage`, `workspace_can_accept_response`, Stripe routes and webhooks, trials, usage meters, upgrade dialogs, pricing, DPA and subprocessor pages, plan-gated fonts, plan-gated footer removal, plan-gated pixel counts, plan-gated domain counts. Doc 05 is rewritten as `05-workspaces-and-admin.md` covering settings, members, invites, onboarding, platform admin, and the organization privacy notice.
- **R13. Upload limits.** Fixed globals from the table above, with per-workspace overrides in `workspace_limits` that only a platform admin edits. Doc 02 reads limits from there.
- **R14. Turnstile.** One widget registered for the public hostname. No per-domain question remains.
- **R15. Public pages on a separate fixed hostname.** Raised by doc 02 during revision. If public surveys and the dashboard share one origin, a workspace's `custom_script` pixel or a GTM container (which can load arbitrary scripts) runs on the same origin as a signed-in member's Supabase session cookies and could read them when that member opens any public survey. Ruling: the public survey pages are served from a second fixed hostname of the same organization domain, pointing at the same Vercel deployment. `proxy.ts` picks the route group by hostname. Supabase auth cookies are scoped to the dashboard hostname. Builder preview runs on the dashboard hostname with pixels disabled. This is two hostnames, not custom domains; nothing per-workspace changes. Public read-only report share links (doc 04) are also served from the public hostname at `/r/{token}` and never load pixels. The abuse report form lives at `/report?s={slug}` and the organization privacy notice at `/privacy`, both on the public hostname. If the owner rejects the second hostname, the fallback is to remove the `custom_script` and `gtm` pixel types and keep only GA4 and Meta Pixel, whose scripts are fixed vendor code. Owner to confirm.

## Glossary

- **Workspace**: tenant, a department or team. Owns everything.
- **Member**: a signed-in user with a role in a workspace.
- **Platform admin**: a profile flag. Runs invites and workspace creation for the whole deployment. Deployment-wide settings such as the privacy notice live in `platform_settings`.
- **Survey**: the container. Has versions.
- **Version**: a frozen definition. Responses point here.
- **Question**: one field in a version. Has a `question_key` stable across versions.
- **Option id**: the stable identifier of a choice option within a question. Answers store it, never the label.
- **Response**: one submission (partial or complete).
- **Answer**: one question's value within a response.
- **Respondent**: whoever filled out a response. May or may not resolve to a contact.
- **Contact**: an identified person in a workspace's CRM.
- **Token**: a personalized link credential tying a response to a contact.

## Document map

- `01-data-model.md`: schema, RLS, versioning, response storage, respondent identity, contacts, all tables from every doc.
- `02-public-delivery.md`: URLs, slugs and aliases, states, submission handler, security, uploads, pixels, QR, footer.
- `03-builder-and-logic.md`: question types, logic engine, renderer, validation, builder UX, collaboration.
- `04-crm-analytics-privacy.md`: contacts and leads, events, reports, sharing, exports, privacy controls.
- `05-workspaces-and-admin.md`: workspace settings, members, invites, onboarding, platform admin, limits, privacy notice.
- `06-build-plan.md`: phases and agent assignments for implementation (written after 01 to 05 are reconciled).
