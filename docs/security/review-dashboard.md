# Security review: dashboard host

Scope: dashboard host code at commit 4ab1744 (Phase 2). Covers src/lib/auth, the Supabase clients, everything under src/app/(dashboard), src/app/api/auth, src/lib/admin, builder, crm, analytics (except events.ts and share.ts, which are read only for item 9), exports, privacy, the db wrappers and the dashboard components. SQL was read only where a server action or route relies on it. Uncommitted work (migration 0018, src/types, src/lib/hosts.ts) was not reviewed.

Method: every server action and route handler under (dashboard) and api/auth was read, along with every createAdminClient call site in scope. Each finding below was checked against the code. Anything not fully proven is marked PLAUSIBLE.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| D-01 | High | Unverified email signup activates email-matched platform invites (invite gate bypass, plus PLAUSIBLE pre-account takeover) | supabase/config.toml:215; src/app/(dashboard)/login/actions.ts:53; supabase/migrations/0004_signup_and_invites.sql:80 |
| D-02 | Medium | Platform admin can mint a reset link for any account, including other platform admins (impersonation by design, no guardrails) | src/lib/admin/service.ts:154; src/app/(dashboard)/admin/actions.ts:190 |
| D-03 | Medium | Workspace admins can read and hand out owner-created admin-role invite links | src/app/(dashboard)/w/[slug]/settings/invites/page.tsx:23; supabase/migrations/0003_workspaces.sql:719 |
| D-04 | Medium | Contact CSV export and personalized link CSV write no activity_log row | src/lib/crm/export.ts:15; src/app/(dashboard)/w/[slug]/contacts/export/route.ts:9; src/app/(dashboard)/w/[slug]/contacts/actions.ts:260 |
| D-05 | Low | Row-level export runs on a cross-site GET (export job, storage write and log triggered by navigation) | src/app/(dashboard)/w/[slug]/surveys/[id]/analytics/export/route.ts:162 |
| D-06 | Low | CSV injection guard does not cover semicolon-delimiter locales or leading whitespace | src/lib/exports/csv.ts:16; src/lib/crm/csv.ts:25 |
| D-07 | Low | Client-chosen invite token and expiry on insert under RLS | supabase/migrations/0003_workspaces.sql:375 (guard_workspace_invite); src/lib/admin/db/invites.ts:39 |
| D-08 | Low | Invite and share tokens copied into activity_log diffs | supabase/migrations/0003_workspaces.sql:190 |
| D-09 | Low | Demoted creator keeps fresh signed URLs for their own export jobs | src/app/(dashboard)/w/[slug]/surveys/[id]/analytics/export/route.ts:176; supabase/migrations/0013_reports_exports.sql:325 |
| D-10 | Low | No rate limits on authenticated abuse surfaces | several, see section |
| D-11 | Low | Admin audit gaps when a service call half succeeds | src/lib/admin/service.ts:48, :164; src/app/(dashboard)/admin/actions.ts:206 |
| D-12 | Low | REPORT_SHARE_SECRET falls back to a key derived from the service role key; share passwords use MD5-crypt | src/lib/analytics/share.ts:24; src/lib/analytics/password.ts:63 |
| D-13 | Low | Realtime DELETE events on responses reach any authenticated subscriber (PLAUSIBLE) | src/components/responses/subscribe.ts:5; supabase/migrations/0017_realtime.sql |
| D-14 | Info | Raw SQL error detail returned to the browser | src/app/(dashboard)/w/[slug]/contacts/actions.ts:71; src/lib/exports/jobs.ts:186 |
| D-15 | Info | Tenant confusion: ids from the URL are not always tied to the slug's workspace (RLS still holds) | see section |
| D-16 | Info | Invite tokens stored in signup user_metadata (auth.users and the JWT) | src/app/(dashboard)/login/actions.ts:66 |
| D-17 | Info | logo_path and og_image_path are free strings; publicAssetUrl passes absolute URLs through | src/lib/admin/db/workspace.ts:90; src/lib/builder/queries.ts:160; src/lib/builder/share.ts:39 |
| D-18 | Info | Small hardening items: logo body read when Content-Length is absent, password length 6 in Supabase vs 8 in the app, lookup ilike treats `_` as a wildcard | see section |

Counts: Critical 0, High 1, Medium 3, Low 9, Info 5.

---

## D-01 High: unverified email signup activates email-matched platform invites

**What the code does.** In supabase/config.toml, `[auth.email] enable_signup = true` (line 210) and `enable_confirmations = false` (line 215). Any holder of the public anon key can therefore call `supabase.auth.signUp({ email, password })` directly with any email address, and the account is confirmed immediately. The `handle_new_user` trigger (0004:111) calls `apply_invites(new.id, new.email, ...)`. Step 3 of apply_invites (0004:80 to 83) activates the profile when `lower(email)` matches an open `platform_invites.email`. `claim_pending_invite()` (0004:139), which `/pending` "Check again" and every sign-in call, does the same match. Doc 05 section 4.1 says "a bare API signup still lands in pending". That holds only when the email has no open invite.

**Exploit.** Caller role: anonymous internet user. A platform admin issues an email-bound invite for `jane@org.example`; the address can be guessed or learned from the org directory. Before Jane signs in, the attacker runs `signUp({ email: 'jane@org.example', password: 'x'.repeat(8) })` against the Supabase Auth endpoint. The trigger finds the invite, marks it used by the attacker, and activates the profile. The attacker is now an active user. The admin list shows "Claimed by jane@org.example" with no mismatch warning, because the email matches. The next likely step is that the admin picks "Jane" as owner in `admin_create_workspace`, or a workspace owner invites her, and the attacker gets the department's data.

PLAUSIBLE escalation (pre-account takeover): with autoconfirm on, the attacker's identity counts as email-confirmed. When the real Jane later signs in with Google, Supabase automatic identity linking joins the Google identity to the existing user with the same verified email. The attacker keeps password access to Jane's real account. To confirm: on a staging project, sign up with a password for an address you control in Google, then sign in with Google, and check whether `auth.identities` now has both providers on one user id.

**Why it matters.** It defeats the invite-only gate that the whole tenancy model depends on, and it does so silently: the audit trail looks normal.

**Fix.** Never activate on an email that Supabase has not verified through a real mailbox or an OAuth provider. Options, any one of which closes it:

```sql
-- apply_invites step 3: only trust provider-verified email
if not v_activate and v_status = 'pending' and v_email is not null
   and exists (select 1 from auth.identities i
               where i.user_id = p_user_id and i.provider <> 'email'
                 and lower(i.identity_data ->> 'email') = v_email
                 and coalesce((i.identity_data ->> 'email_verified')::boolean, false)) then
  ...
```

Also add a Supabase "before user created" auth hook (or set `enable_signup = false` for the email provider) so password accounts are created only when an invite token is present, and that token is checked server side. The signup action already requires one in the UI; a hook makes it binding. Keep the token path, because the token itself is the credential (doc 05 section 3.1).

---

## D-02 Medium: platform admin can mint a reset link for any account

**What the code does.** `mintResetLink` (admin/actions.ts:190) checks requirePlatformAdmin, then `mintPasswordResetLink(userId)` (service.ts:154). That function calls `admin.auth.admin.generateLink({ type: 'recovery', email })` for whatever user id was posted, writes `password_reset.mint` to platform_audit_log, and returns the action link to the browser in ActionState.data.link. Nothing stops the target from being another platform admin, the caller themself, or a user with no password identity (Google only).

**Exploit.** Caller role: platform admin. The admin mints a link for another platform admin or for any workspace owner, opens it in a private window, and is signed in as that user. Doc 00 says platform admins "do not read workspace data unless they are also members". This path gets around that. The audit row records the mint but not whether the link was used, or by whom.

**Why it matters.** It is impersonation of any user, including other admins, which the task brief says should not exist. A single compromised platform admin session turns into every account.

**Fix.** Refuse targets that are platform admins or the caller. Require a typed confirmation. Record whether the target had a password identity at all.

```ts
const target = await admin.from('profiles').select('is_platform_admin').eq('id', uid).single()
if (uid === actorId || target.data?.is_platform_admin) return fail(makeDbError('not_authorized'))
const user = await admin.auth.admin.getUserById(uid)
if (!user.data.user?.identities?.some((i) => i.provider === 'email')) return fail(makeDbError('invalid_state', 'This user signs in with Google only.'))
```

Write the audit row before returning the link, and fail closed if the audit insert errors (see D-11). Consider requiring two platform admins (doc 05 open question 1).

---

## D-03 Medium: workspace admins can read and redistribute admin-role invite links

**What the code does.** The insert policy allows an `admin` invite only for owners (0003:721). The select policy `workspace_invites_select` (0003:719), however, is `is_member(workspace_id, 'admin')`. The invites page (invites/page.tsx:23 to 32) builds `url: inviteUrl(i.token)` for every row, including admin-role invites the owner created, and InvitesTable shows a Copy button for each.

**Exploit.** Caller role: workspace admin. The owner creates a 5-use admin invite for a colleague. Any admin opens Settings, Invites, copies that link, and gives it to a person of their choosing, or signs in with a second account. That person joins as admin. The capability matrix (doc 05 section 2.3) says admins may create invite links for editor and viewer only, so this hands out a role the admin cannot grant.

**Fix.** Hide the token of admin-role invites from non-owners in both SQL and the UI:

```sql
create policy workspace_invites_select on workspace_invites for select to authenticated
  using (is_member(workspace_id, 'admin') and (role <> 'admin' or is_member(workspace_id, 'owner')));
```

In the page, set `url: role === 'owner' || i.role !== 'admin' ? inviteUrl(i.token) : null`. Also see D-08: the token is also copied into activity_log.

---

## D-04 Medium: contact export and token-link CSV are not logged

**What the code does.** `contacts/export/route.ts` streams every contact field (email, phone, custom fields, owner) through `contactsCsvStream`. The comment at crm/export.ts:15 to 18 admits it writes no activity_log row. `generateLinksAction` (contacts/actions.ts:260) returns a CSV of personalized links, and each token is a credential to answer as that contact. That is not logged either. Doc 05 section 2.3 and doc 04 section 6 require "Every export writes an activity_log row".

**Exploit.** Caller role: editor. The editor bulk-exports all contacts, or mints and downloads link CSVs, and nothing records it. After an incident, an admin cannot answer "who took the contact list".

**Fix.** Add the `log_export` SQL function from the Phase 2D change request (editor check, security definer, granted to authenticated). Call it from both paths before streaming, with the filter and the row count, as the analytics export route already does. Fail the export if the log write fails.

---

## D-05 Low: row-level export reachable through a cross-site GET

**What the code does.** The export route's `GET` (route.ts:162 to 175) runs the full `runExport`. Above 5,000 rows, that creates an `export_jobs` row, spends up to 300 s building the file, uploads it with the service role, and logs it. The `sameOrigin` check runs only on `POST` (line 62). Auth cookies are `SameSite=Lax`, which browsers send on top-level cross-site GET navigations.

**Exploit.** Caller role: any outside site, acting through a signed-in editor. A link or `window.open` to `https://DASHBOARD_HOST/w/{slug}/surveys/{id}/analytics/export?format=xlsx` makes the victim's browser start a heavy job and write a misleading activity_log entry under the victim's name. The attacker cannot read the file. The impact is compute and storage cost, plus log pollution.

**Fix.** Keep GET for the `?job=` status poll only. Turn the inbox "Export" link into a form POST, or require a `Sec-Fetch-Site: same-origin` header on GET exports:

```ts
if (req.headers.get('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin') return json({ error: 'forbidden' }, 403)
```

---

## D-06 Low: CSV injection guard gaps

**What the code does.** `guardInjection` (exports/csv.ts:16 to 19) prefixes `'` when a cell starts with `= + - @ \t \r`, and lets pure numbers matching `^-?\d+(\.\d+)?(e[+-]?\d+)?$` through. `crm/csv.ts:25` has the same character set and no numeric exemption. Quoting happens only when a cell contains `,`, `"`, CR or LF.

**Judgment on negative numbers.** The numeric exemption is safe. The regex is anchored, so `-5` or `-0.25e3` cannot carry a formula, and Excel and Sheets read them as numbers, never as expressions. The behavior noted in docs/06 is fine.

**Remaining gaps (PLAUSIBLE, locale dependent).**
1. In locales where Excel's list separator is `;` (most of Europe), a respondent answer such as `Paris;=HYPERLINK("http://x","click")` is not quoted, because it has no comma. Excel then splits it into a second cell that starts with `=`. To confirm: open an export containing that value in Excel with a German regional setting.
2. Leading whitespace or a leading LF is not guarded. Current Excel does not evaluate `  =1+1` from CSV, and LF cells are quoted, so this is defense in depth only.

Respondent-controlled values in scope: free text, `Other` text, hidden fields (URL params), UTM values, address parts, contact name and company fields. Header ids and labels go through the same `csvLine`, so question labels are covered. In XLSX, exceljs writes plain strings as text cells, never formulas, so XLSX is not exposed. The `'` prefix there is only cosmetic.

**Fix.** Quote every cell, and treat `;` as a separator character:

```ts
export function escapeCsvCell(value: unknown): string {
  const s = guardInjection(value == null ? '' : String(value))
  return `"${s.replace(/"/g, '""')}"`
}
export function guardInjection(v: string): string {
  if (v === '' || NUMERIC.test(v)) return v
  return /^[\s]*[=+\-@\t\r\n]/.test(v) ? `'${v}` : v
}
```

Apply the same change to crm/csv.ts. **Content-Disposition filenames are sound:** the survey title is reduced to `[a-z0-9-]` (route.ts:52), and the contacts filename uses the slug, which matches `^[a-z0-9-]+$` under a SQL check.

---

## D-07 Low: client-chosen invite token and expiry

**What the code does.** `guard_workspace_invite` on insert (0003 around line 375) resets `used_count`, `revoked_at` and `created_by`, but keeps whatever `token` and `expires_at` the client sent. The table checks `max_uses between 1 and 50`, but the expiry has no upper bound. The wrapper computes 1, 7 or 30 days, but an admin can call PostgREST directly through the browser client session.

**Exploit.** Caller role: workspace admin. The admin inserts `{ token: 'aaaaaaaa', expires_at: '2999-01-01', role: 'editor', max_uses: 50 }`. The result is a guessable, effectively permanent invite link. This is low because admins are already trusted to invite, but it defeats the "expiry caps exposure" reasoning in doc 05 section 3.2.

**Fix.** In the insert branch, force `new.token := gen_token(24)` and clamp `new.expires_at` to `now() + interval '30 days'`. Do the same for platform_invites.

---

## D-08 Low: tokens copied into activity_log

**What the code does.** `log_activity` (0003:179) records every changed column except the list at line 190. That list does not include `token`. The triggers on `workspace_invites` (0003:397) and `report_shares` (0013:70) therefore store the plaintext token in `activity_log.diff`, which the activity page shows to admins. The rows outlive revocation and are pruned only by the activity log retention job.

**Why it matters.** It widens D-03, since a revoked or hidden token stays readable. The share token is the only credential for an open `/r/{token}` link.

**Fix.** Add `'token'` to `v_skip`, and redact old rows: `update activity_log set diff = diff - 'token' where entity in ('invite','share');`.

---

## D-09 Low: demoted creator can re-sign their export jobs

**What the code does.** The `GET ?job=` branch (route.ts:176 to 181) requires only `viewer` and then signs a fresh one-hour URL with the service role (`signedJobUrl`). `export_jobs_select` (0013:325) lets the creator read their own job at any role.

**Exploit.** An editor starts a large export and is demoted to viewer. For the next 7 days, until the storage sweep runs, they can still pull fresh signed URLs for that row-level file.

**Fix.** Require `editor` in the job branch: `if (!roleAtLeast(m.role, 'editor')) return json({ error: 'not_authorized' }, 403)`. Also change the policy to `created_by = auth.uid() and is_member(workspace_id, 'editor')`.

---

## D-10 Low: no rate limits on authenticated surfaces

None of the following has an app or SQL rate limit. Each is bounded only as noted:

| Surface | Code | Existing bound |
|---|---|---|
| Workspace invite creation | settings/actions.ts:182 | none (list shows the latest 200) |
| Platform invite creation | admin/actions.ts:52 | platform admin only |
| Personalized link generation | contacts/actions.ts:260, crm/tokens.ts:26 | contactIds not capped (chunks of 500); server action body limit, default 1 MB |
| Export jobs | analytics/export/route.ts | none; each job can run 300 s (see D-05) |
| Import chunks | contacts/actions.ts:246 | `prepareImportRows` per chunk; no cap on chunks per import |
| Report share creation | reports/actions.ts:139 | none; also allows no-expiry links (`expiresDays: 0`) |
| Reset link minting | admin/actions.ts:190 | none |
| Realtime subscriptions | components/responses/subscribe.ts | Supabase project quotas only |

**Fix.** Reuse `rate_limit_hit` with a per-user key, for example 30 per hour on invites, shares and link generation, and 10 per hour on export jobs. Add a `max_open_invites` and `max_share_links` column to workspace_limits. Cap `contactIds` at 5,000 with zod in the action.

---

## D-11 Low: audit gaps when a service call half succeeds

- `insertAudit` (service.ts:45 to 48) only logs to the console on failure. `mintPasswordResetLink` calls it after `generateLink` (line 164) and returns the link either way, so a reset link can be issued with no audit row.
- `setUserActive` (admin/actions.ts:206 to 212) changes `profiles.status` under RLS first, with no audit row, and the audit row is written only inside `setAuthBan`. If the ban call fails, the status change is not audited.
- `auditPlatformAction` calls in actions.ts run after the SQL write and also fail open.

**Fix.** Write the audit row first and abort when it fails. For profile status, move the change into a SQL function that calls `write_platform_audit` in the same transaction.

---

## D-12 Low: share cookie secret fallback, MD5-crypt passwords

**What the code does.** `shareCookieSecret` (share.ts:24 to 27) uses `REPORT_SHARE_SECRET`, or else `SUPABASE_SERVICE_ROLE_KEY`. The AES-GCM key is `sha256('report-share-cookie:' + secret)` (share-payload.ts:133). `REPORT_SHARE_SECRET` is missing from .env.example, so the fallback is the default.

**Judgment.** The derivation does not leak the service role key: SHA-256 with a domain prefix is one-way, and the key never reaches the client. The risks are operational. Rotating the service role key silently invalidates every password cookie. One secret also serves two purposes, so anyone who can read the env for share debugging holds the master key. And if the secret is ever logged in a share context, it is the full database bypass. This is acceptable for v1, but it should be a separate secret. Separately, `hashSharePassword` (password.ts:63) stores MD5-crypt with 1,000 rounds. The hash is readable by every editor through `report_shares_select`, and MD5-crypt is cheap to crack offline for 6-character passwords (`SHARE_PASSWORD_MIN = 6`).

**Fix.** Add `REPORT_SHARE_SECRET` to .env.example and throw when it is unset in production. Move hashing to SQL with `crypt(p, gen_salt('bf', 10))`, and stop selecting `password_hash` in the dashboard (`listShares` only needs a boolean).

---

## D-13 Low (PLAUSIBLE): realtime DELETE events cross tenants

**What the code does.** Migration 0017 adds `public.responses` to `supabase_realtime`. Supabase Realtime applies RLS to INSERT and UPDATE payloads, but it cannot apply RLS to DELETE events. Those carry the primary key, and the default replica identity is in use here, which the migrations confirm (no `replica identity` statement).

**Exploit.** Caller role: any authenticated user, including a pending one. The user subscribes to `postgres_changes` on `responses` with `event: 'DELETE'` and no filter, and sees the id and timing of every response deletion and retention purge across all workspaces. Ids are random UUIDs, so the leak is metadata only. To confirm: subscribe as a user with no memberships and delete a response in another workspace.

**Fix.** Switch the inbox to private broadcast channels authorized by `realtime.messages` RLS, or accept the risk and record it in docs/00.

---

## D-14 Info: raw SQL detail reaches the browser

`setCustomAction` (contacts/actions.ts:71) returns `${message} (${detail})`, and `detail` holds the raw Postgres message. `finishJob` (jobs.ts:186) puts `e.message` into the error detail. The export route maps that to a fixed string, but other callers may not. Return the canned `message` only, and log `detail` on the server.

## D-15 Info: tenant confusion, RLS holds

Some code takes ids from the URL or action arguments without tying them to the workspace in the slug:

- `responses/[responseId]/page.tsx:46` calls `getSurvey(supabase, { surveyId: id })` with no workspace scope. It checks `response.survey_id === id`, but never checks the survey against the slug's workspace.
- `responses/files/[fileId]/route.ts:17` signs any `response_files` row the caller can read. It ignores `slug` and `id` and does not check the profile status. The status check is unneeded, because `is_member` requires `status = 'active'`.
- `contacts/actions.ts`: `updateContactAction`, `setCustomAction`, `editNoteAction`, `deleteNoteAction`, `mergeAction`, `importChunkAction` and `deleteViewAction` act on ids under the member client. They call requireMember for the slug, but do not check that the object belongs to it.
- `lib/builder/actions.ts` takes no slug at all and relies on SQL (`take_draft_lock`, `save_draft` and `create_survey` all check `is_member(..., 'editor')`).
- `privacy-tools/export/route.ts:15` takes `?contact=`. `export_respondent_data` checks editor on the contact's own workspace, then service-role signing runs only on paths that function returned.

Every one of these runs as the member, so a caller can only reach rows in workspaces where RLS already allows them. None is exploitable. Adding `.eq('workspace_id', workspace.id)` would keep the URL and the data consistent, and would close the gap if a wrapper is ever switched to the service role.

## D-16 Info: invite tokens in user_metadata

`signUpWithPassword` (login/actions.ts:66 to 71) puts the invite tokens in `options.data`. They are stored permanently in `auth.users.raw_user_meta_data` and appear in every access token's `user_metadata`. The user already holds the token, and SQL revokes or uses it up, so the exposure is low. After the trigger claims it, clear it with `admin.auth.admin.updateUserById(id, { user_metadata: {} })`, or have the trigger strip it.

## D-17 Info: free-form asset paths

`setLogoInput` (admin/db/workspace.ts:90) accepts any string of 300 characters or fewer, and `og_image_path` (builder/queries.ts:160) any string of 500 or fewer. Neither has a SQL check, so admins and editors can store another workspace's path or an absolute URL. `publicAssetUrl` in builder/share.ts:39 returns absolute `http(s)` URLs unchanged. The dashboard CSP `img-src` blocks external hosts, so there is no impact on the dashboard. On the public page, an editor could make respondents' browsers fetch a third-party host without pixel consent. That is PLAUSIBLE and depends on src/lib/public/load.ts, which is out of scope. Fix: add a check constraint, `og_image_path ~ ('^' || workspace_id || '/')`, and do the same for logo_path.

## D-18 Info: hardening

- Logo route (logo/route.ts:32) skips the size check when `Content-Length` is absent (chunked upload), then buffers the whole form. `checkLogo` rejects files over 1 MB afterwards, and Vercel caps request bodies at 4.5 MB, so this costs a little memory only.
- `minimum_password_length = 6` in config.toml:181, while the app requires 8. Direct API signups (see D-01) get 6. Set it to 8 and turn on leaked-password protection in production.
- `findRespondents` (privacy/lookup.ts:71, 74) uses `ilike` with the typed email, so `_` in a valid address matches any single character. The admin still confirms by typing the matched contact's own email before an erase, so the impact is display noise only. Use `.eq` on the normalized email.

---

## Checked and found sound

1. **Authorization at mutations.** Every server action under `w/[slug]` calls `requireMember(slug, minRole)`. The exceptions are the builder actions (`getAuthContext` only) and `fetchInboxRowAction`. All of them run the user client, and the SQL checks are correct: `archive_workspace`, `unarchive_workspace`, `request_workspace_deletion` and `transfer_workspace_ownership` check `caller_role = 'owner'` or platform admin; `guard_workspace_member` restricts admin changes to the owner; `erase_respondent` requires admin and `export_respondent_data` requires editor. No server action or route takes a role, user id or admin flag from the form for authorization: `addNote` and `createContactView` use `user.id` from the session, `changeRole` excludes `owner` in zod, and SQL blocks admin promotion by non-owners. Inputs are validated with zod in the actions or wrappers, and zod strips extra keys on contact patches and survey settings.
2. **Service role call sites in scope, with their guards.**
   - admin/service.ts: every export calls `requirePlatformAdmin()` before `createAdminClient()` (line 33).
   - admin/purge.ts:84: `isCronAuthorized` (timing-safe compare, false when the secret is unset) runs first.
   - privacy/retention.ts:27: called only from the cron route behind CRON_SECRET.
   - privacy/erase.ts:23: runs only after `erase_respondent` succeeds as the member, with an admin check in SQL.
   - privacy/gdpr.ts:24: signs only the paths returned by `export_respondent_data`, with an editor check in SQL.
   - exports/jobs.ts:167, 194, 220: called after `requireMember` and an editor check. The job row comes from an RLS insert. `signedJobUrl` checks the workspace prefix, and the job GET checks `job.workspace_id === m.workspace.id`. `logExport` uses the workspace id from requireMember.
   - No `src/app` file imports admin.ts.
3. **Auth flow.**
   - `/login/google` is a GET, but PKCE prevents login CSRF: the code verifier lives in the victim's host-only cookie, so an attacker's code cannot be exchanged.
   - `next` is filtered by `safeNextPath` everywhere (callback, login page, postSignInPath, oauth redirectTo), which rejects `//`, backslashes, control characters and other origins.
   - Callback redirects use `url.origin` plus a path.
   - Invite cookies are HttpOnly, Secure outside dev, SameSite=Lax, Path=/, Max-Age 3600, with no Domain. `hostOnlyCookieOptions` strips Domain from every auth cookie.
   - Sign-out is a server action (POST with Next's Origin check).
   - The proxy refreshes the session with `getUser()` on the dashboard host only and never on PUBLIC_HOST.
   - Pending users reach only /pending, /login, /invite and RLS-protected wrappers.
   - Disabled users are blocked by `requireUser`, by `is_member` and `caller_role` (`status = 'active'`), by `is_platform_admin`, by `apply_invites`, and by the Supabase ban.
4. **Invites and platform admin.**
   - Tokens are `gen_token(24)`: 192 bits from `gen_random_bytes`.
   - Expiry, revocation, max uses and membership are enforced in SQL (`apply_invites`, with `for update`).
   - `/invite/[token]` does no lookup, so it never reveals whether a workspace exists.
   - The `/admin` layout and every admin page and action call `requirePlatformAdmin`, and the SQL admin functions check `is_platform_admin()`.
   - Reset links are not stored or logged.
   - Every SQL admin function writes to platform_audit_log.
5. **Uploads.**
   - The logo route sniffs PNG, JPEG and WebP from the bytes, rejects SVG, checks the size limits, builds the path from the workspace id and a content hash with a regex-validated name, and requires the Origin header to match. Storage RLS requires admin for `{ws}/logo*` and editor for other paths, so no workspace can overwrite another's objects.
   - The builder ImageUpload is bounded by the bucket MIME allowlist (images only).
   - The response file route mints a 60 s signed URL with download disposition by default. The `response-files` allowlist excludes HTML and SVG, so `?inline=1` cannot serve active content, and the signed host is the Supabase origin.
6. **XSS.**
   - No `dangerouslySetInnerHTML` in the repo.
   - MarkdownView and the survey richtext build React elements, and links pass `safeHref` (https and mailto only).
   - Custom URL fields are checked with `^https?://` in SQL.
   - Answers, notes, tags, file names and activity diffs render as React text.
   - The dashboard CSP is nonce-only, with no third-party scripts.
7. **Locks and revisions.** `take_draft_lock` with `force` requires editor on the version's own workspace, bumps the revision and logs the takeover. `save_draft` requires that the caller holds the lock and that the revision matches, so a stale revision cannot win.
8. **Secrets.** `CRON_SECRET` is compared in constant time. No `NEXT_PUBLIC_` variable holds a secret (only the URL, anon key and Turnstile site key), and no client component references the service role key. The only logging is the purge summary (counts and ids).
9. **DB wrappers.** Every wrapper validates with zod and returns canned messages. The only interpolated PostgREST filters use a server-computed ISO date (privacy/status.ts:20) and a zod-validated uuid (builder/queries.ts:116). No wrapper accepts a client-chosen column list or table name.
10. **Slug history.** `workspace_slug_history` is readable only by members of the workspace, so the old-slug redirect leaks nothing to non-members. The known gap in docs/06 (a nested page can 404 before the layout redirects) is a UX issue, not a security one.
