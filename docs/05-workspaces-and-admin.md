# 05. Workspaces, members, invites, and platform admin

Builds on `00-decisions.md`, which wins on any conflict. Replaces `05-product-and-billing.md` per R12. This is an internal tool: workspaces are departments or teams, there is one domain, and the app never sends email. Tables proposed here are added to doc 01's DDL under this doc's name (R11); doc 01 owns final names and types.

## 1. Workspace model

### 1.1 How a department gets a workspace

**Decision: only a platform admin creates workspaces.** The admin enters a name, a slug, and picks the first owner from any active or pending profile. `admin_create_workspace(p_name, p_slug, p_owner)` inserts the workspace and the owner membership in one transaction and activates the owner's profile if it was pending.

Why not self-serve: departments are org structure. Self-serve creation produces duplicate workspaces, abandoned ones still holding respondent PII, and no accountable owner. Creation is rare, so the admin cost is tiny.

An active user with no memberships lands on `/welcome`: "You are not in any workspace yet. Ask your workspace owner for an invite link, or request a new workspace." The request form (department name, purpose) writes to `workspace_requests`, which the platform admin approves (opens the create form prefilled) or dismisses.

If the intended owner has never signed in, the admin issues a platform invite first (3.1); once they sign in they appear in the picker. Pending sign-ins are pickable too.

### 1.2 Workspace slug

Dashboard URLs are `/w/{slug}/...`. Public survey links never contain the workspace slug, so renaming a workspace never breaks a printed QR code.

- Pattern: `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, 3 to 40 chars, no consecutive hyphens, globally unique.
- Reserved: `admin`, `api`, `app`, `auth`, `new`, `settings`, `welcome`, `pending`, `invite`, `join`, `privacy`, `report`, `s`, `w`, `r`.
- Owner or admin may rename. The old slug goes into `workspace_slug_history(slug, workspace_id, released_at)` and redirects to the new one for 30 days (same hold as survey aliases), then is free.

### 1.3 Archiving

Owner or platform admin. `workspaces.archived_at` set.

- Members keep read access; `is_member` refuses any min role above viewer, so all writes fail.
- Public surveys show their closed message. Survey states are untouched, so unarchiving restores everything.
- Retention jobs and activity log pruning keep running.
- The switcher hides archived workspaces under "Show archived".

### 1.4 Deleting

**Who:** the owner (from General, after typing the slug) or a platform admin. A workspace must be archived for at least 7 days before deletion is offered. That forces a cooling period with no email to warn anyone.

**How:** `workspaces.deleted_at` is set and the workspace disappears for everyone. For 30 days a platform admin can restore it. After 30 days the Vercel Cron job (R3, it touches Storage) hard-deletes:

- Cascades: surveys, versions, questions, responses, answers, events, contacts, notes, tokens, report shares, pixels, invites, members, `workspace_limits`, `activity_log` rows, and every Storage object under `{workspace_id}/` in `public-assets` and `response-files`.
- Retained: one `platform_audit_log` row with the workspace id, name, slug, owner, deleted by, and final counts (surveys, responses, contacts, bytes). Survey aliases and the workspace slug are held 30 more days and then released.

Why only counts: deletion must actually delete respondent data, but the org needs a record of who removed what.

## 2. Members and roles

### 2.1 Member list

`/w/{slug}/settings/members`: avatar, name, email, role, joined date, invite label. Every member sees the list.

### 2.2 Rules

- Exactly one owner, enforced by the partial unique index `workspace_one_owner` and the guard trigger in doc 01.
- Owner may change any other member's role and remove anyone except themselves.
- Admin may change and remove editors and viewers. Promoting to admin, and demoting or removing an admin, is owner only.
- Any non-owner may leave. The owner cannot leave or be removed; they must transfer first.
- **Transfer ownership:** the owner picks any existing member. `transfer_workspace_ownership(p_ws, p_new_owner)` makes the target owner and the old owner admin in one transaction.
- **Forced transfer:** a platform admin may run the same function without being a member, for when an owner leaves the organization. Logged in `platform_audit_log` and `activity_log`.
- Removing a member keeps everything they created.

### 2.3 Capability matrix

| Capability | Viewer | Editor | Admin | Owner |
|---|---|---|---|---|
| See surveys, results, reports | yes | yes | yes | yes |
| Read individual responses and answers | yes | yes | yes | yes |
| Read contacts and contact timeline | yes | yes | yes | yes |
| Export aggregate report (charts, summary CSV) | yes | yes | yes | yes |
| Export row-level responses or contacts | no | yes | yes | yes |
| Create, edit, publish, close surveys | no | yes | yes | yes |
| Delete surveys | no | yes | yes | yes |
| Edit, tag, merge contacts, add notes | no | yes | yes | yes |
| Create personalized token links | no | yes | yes | yes |
| Create report share links | no | yes | yes | yes |
| Erase or anonymize a respondent | no | no | yes | yes |
| General settings (name, slug, logo, theme, footer) | read | read | yes | yes |
| Tracking pixels | no | read | yes | yes |
| Privacy settings | read | read | yes | yes |
| Create and revoke invite links | no | no | yes (editor, viewer) | yes (any non-owner role) |
| Change roles, remove members | no | no | editors, viewers | everyone but self |
| Activity log | no | no | yes | yes |
| Limits (read only) | yes | yes | yes | yes |
| Transfer ownership, archive, delete workspace | no | no | no | yes |

**Viewers see contacts (resolves doc 01 open question 3).** Viewers already read every response, which contains the same email and phone. Hiding contacts would hide nothing. The real control is who becomes a viewer.

**Viewers cannot export row-level data (resolves doc 04 open question 6).** On screen, data stays inside RLS; a CSV leaves for good and respondent erasure can never reach it. That bulk copy requires editor, the role trusted with contacts. Aggregate exports carry no row-level PII. Every export writes an `activity_log` row (`entity = 'export'`).

## 3. Invite links

Nothing is emailed. Every invite is a link the creator copies and shares however they like.

### 3.1 Platform invites

Grant the right to be an active user. Issued only by platform admins at `/admin/invites`.

Proposed change to doc 01's `platform_invites` (adds token, expiry, revoke; email becomes optional):

```sql
alter table platform_invites
  alter column email drop not null,
  add column token      text not null unique default gen_token(24),
  add column expires_at timestamptz not null default now() + interval '30 days',
  add column revoked_at timestamptz;
```

Claimed two ways:

1. **Email match.** On signup the `handle_new_user` trigger activates the profile when `lower(email)` matches an unused, unexpired, unrevoked invite. A user who signed in before the invite existed presses "Check again" on `/pending`, which calls `claim_pending_invite()`. This is the Fresno Skillshare 00012 and 00017 pattern.
2. **Token link** `/invite/{token}`. Stores the token in an HttpOnly cookie, sends the user through sign-in, and `/auth/callback` calls `claim_platform_invite(token)`.

**Google email differs from the invited email.** The token is the credential, so a token claim succeeds whichever account signs in. The admin list then shows "Claimed by jane.doe@gmail.com (invited jane@org.example)" with a warning. Reason: people often have personal and work Google accounts, and blocking just creates a support request. Email match alone never activates a different address.

List view: email or note, created by, created, expires, status (open, claimed, expired, revoked), Copy link, Revoke.

### 3.2 Workspace invites

Grant a role in one workspace and also satisfy the platform gate (00). Table `workspace_invites` is already in doc 01.

- **Create** (admin or owner): role (owner may pick admin, editor, viewer; admin may pick editor, viewer), expiry (1 day, 7 days default, 30 days), max uses (1 default, up to 50), optional label ("Fall interns"). Token is `gen_token(24)`.
- **Link:** `https://survey.example.org/join/{token}`.
- **List:** label, role, created by, expires, uses (`used_count/max_uses`), status, Copy, Revoke. Tokens stay stored in plaintext so admins can copy a link again; RLS limits reads to admin and owner, and expiry caps exposure.
- **Revoke** sets `revoked_at`.

**What the invitee sees** at `/join/{token}` (public, no data beyond this): workspace name, logo, the role offered, and who created the link. Expired, revoked, or exhausted links show "This invite link is no longer valid. Ask the person who sent it for a new one." Signed out users pick Google or email; the token rides an HttpOnly cookie through OAuth. After sign-in, `accept_workspace_invite(token)` locks the row, checks revoked, expiry, uses, and existing membership, inserts the membership, increments `used_count`, and activates a pending profile. An existing member gets "You are already a member" and is sent into the workspace with their current role unchanged.

## 4. Onboarding and auth without email

### 4.1 Sign-in

`/login`: "Continue with Google" first and large. "Use email and password" collapsed below, labeled "Prefer Google. Password reset is not self-serve." Email confirmation is off in Supabase Auth; the platform gate stops strangers instead. The email signup form appears only with an invite cookie present (UX only; a bare API signup still lands in `pending`).

### 4.2 Pending screen

Any profile with `status = 'pending'` is routed to `/pending` from every app route. It shows the signed-in email and: "Survey is invite only. Open the invite link you were sent, or sign in with the email you were invited with." Buttons: Check again (`claim_pending_invite()`), Use another account (sign out), and Request access (name, department, reason) into `access_requests` for the platform admin. Approving a request creates a platform invite tied to that user id and activates them at once.

### 4.3 Password reset

Supabase's default auth SMTP cannot be trusted to deliver. Stance:

- Reset is admin assisted. In `/admin/users` a platform admin presses "Generate reset link", which runs server side:

```ts
const { data } = await admin.auth.admin.generateLink({ type: 'recovery', email: user.email });
// show data.properties.action_link once with a Copy button; never store it
```

- The link expires on Supabase's OTP expiry (set to 24 hours in project config). Each mint writes `platform_audit_log`.
- Signed-in email users can link a Google identity from their profile (Supabase manual identity linking) and stop needing a password.
- If an auth-only SMTP sender is configured later, self-serve reset turns on with no code change.

### 4.4 Several departments, switching

A user may belong to many workspaces with a different role in each. URLs are scoped by `/w/{slug}`, so two tabs can hold two departments. The top-bar switcher lists memberships with role badges. `profiles.last_workspace_id` (new column) decides where `/` lands; a user with one workspace goes straight in, one with none goes to `/welcome`.

## 5. Workspace settings

All under `/w/{slug}/settings/*`. RLS enforces the same minimum roles as the matrix.

### 5.1 General

Name (1 to 80 chars). Slug (section 1.2). Logo: bucket `public-assets`, path `{workspace_id}/logo-{hash}.{ext}`, PNG, JPEG, or WebP, max 1 MB, 128x128 to 2048x2048, square recommended for QR embedding. SVG is rejected because it can carry script. A route handler checks role, sniffed MIME type, and dimensions before upload. Default theme: a doc 03 preset applied to new surveys. `show_powered_by` toggle, default on, nothing gates it. Owner only: Archive and Delete.

Needs on doc 01's `workspaces`: `slug`, `default_theme`, `default_country`, `privacy_notice_url`, `pixel_consent_mode`, `archived_at`, `deleted_at`.

### 5.2 Members

Section 2.

### 5.3 Invites

Section 3.2.

### 5.4 Tracking pixels

GA4, Meta Pixel, GTM, raw script. Applied to every public survey in the workspace; each survey can deselect any. Admin and owner manage; editors see the list. Storage, rendering, CSP, and consent wiring are doc 02.

### 5.5 Privacy

- `store_ip` (default off).
- `retention_days` (null keeps forever).
- `default_country` (ISO code, used for phone formatting and region defaults).
- `privacy_notice_url` (optional, shown beside the org notice).
- `pixel_consent_mode`: `banner` (default), `notice`, `in_form`, per R7. Choosing `notice` requires ticking an acknowledgment, stored with who and when.
- Consent block text and respondent deletion.

Mechanics are doc 04.

### 5.6 Limits

Read-only for every member. Shows each limit from the 00 "Global limits" table with its effective value and a badge: "Default" or "Set by platform admin". Effective values come from `effective_limits(workspace_id)`, which overlays `workspace_limits` on the config defaults:

```sql
create table workspace_limits (
  workspace_id          uuid primary key references workspaces(id) on delete cascade,
  max_file_bytes        bigint,   -- null = global default
  max_files_per_response int,
  max_questions         int,
  max_definition_bytes  int,
  submissions_per_ip_hour int,
  raw_script_pixels_allowed boolean,  -- null = true
  note                  text,
  updated_by            uuid references profiles(id),
  updated_at            timestamptz not null default now()
);
-- select: is_member(workspace_id,'viewer'). No write policies; platform admin RPC only.
```

Storage used is shown for information (no quota in v1).

### 5.7 Activity log

Admin and owner. Reverse chronological. Filters: actor, entity, action, survey, date range. Rows expand to their `diff`. CSV export of the filtered view (logged). Retention is 400 days: pg_cron prunes older rows (R3).

## 6. Platform admin at /admin

`profiles.is_platform_admin`, guarded by doc 01's `guard_profile_privileges()`. `is_platform_admin()` backs every admin RPC, all SECURITY DEFINER. Every action writes `platform_audit_log(id, actor, action, target_type, target_id, details jsonb, created_at)`, which is not workspace scoped so it survives workspace deletion.

| Page | Contents |
|---|---|
| Invites | Issue (email optional, note, expiry), copy, revoke, list with claim status and email mismatch warnings. |
| Requests | `access_requests` and `workspace_requests`: approve or dismiss. |
| Users | Search, status, memberships, Generate reset link, Deactivate (Supabase ban plus `status = 'disabled'`; blocked while the user is an owner until ownership is transferred). |
| Workspaces | Name, slug, owner, member count, survey count, response count, storage used, created, archived. Create workspace (1.1). Archive, restore, delete, force transfer ownership. |
| Workspace limits | Edit `workspace_limits` overrides with a required note. |
| Privacy notice | Edit the organization notice (section 7.1). |
| Abuse reports | Section 7.3. |
| Audit | `platform_audit_log` with filters. |

Counts come from `admin_workspace_stats()`, numbers only. Storage used sums `storage.objects` under the workspace prefix, cached on `workspaces.storage_bytes_used`, reconciled daily.

**Feature flags: dropped.** One organization, one deployment: a deploy is the flag, and there are no beta cohorts. The one real need, a per-workspace kill switch for raw script pixels, is the `raw_script_pixels_allowed` column in `workspace_limits`.

**Impersonation: no.** Platform admins see metadata and counts, never responses, answers, or contacts, unless they are also members of that workspace. Respondents gave data to a department for a stated purpose; an org-wide read path, even read only, widens who sees PII and undercuts the privacy notice. Support works from metadata and screenshots.

## 7. Public page trust basics

### 7.1 Organization privacy notice

Fixed route `/privacy` on the public hostname (R15), alongside `/report?s={slug}` and report share links at `/r/{token}`. Markdown in a singleton `platform_settings` row (`privacy_notice_md`, `updated_at`, `updated_by`), edited by a platform admin, revalidated on save. Every public survey footer links to it, plus "{Workspace} privacy notice" when `privacy_notice_url` is set, even with `show_powered_by` off.

### 7.2 Consent banner

Shown only when at least one pixel would load on that page, following the workspace's `pixel_consent_mode` (R7). Surveys with no active pixels show no banner, since Turnstile and session handling are strictly necessary. Doc 02 renders it; doc 04 records the consent event.

### 7.3 Report abuse

Every public survey footer has a "Report abuse" link, always shown. With no email, reports go to a table.

- Route `/report?s={slug}` on the public hostname (R15): reason (phishing or impersonation, asks for passwords or financial data, harassment, other), details (up to 2000 chars), optional reporter contact. Turnstile and the Postgres rate limiter (5 per IP per hour).
- Stored in `abuse_reports(id, survey_id, workspace_id, reason, details, reporter_contact, ip_hash, status, reviewed_by, reviewed_at, created_at)` with status `open`, `dismissed`, `actioned`. Written by the route handler with the service role; no client policies.
- Platform admins review in `/admin/reports`. Actions: dismiss, close the survey (`admin_close_survey(p_survey_id, p_reason)`, which changes state only and is logged in both audit logs), or archive the workspace. An `/admin` nav badge shows the open count.
- Owners and admins see a banner with the reason on any survey an admin closes.

## Decisions made here

1. Only platform admins create workspaces, with a request form. Departments are org structure; avoids duplicates and orphaned PII.
2. Slug 3 to 40 chars, 30 day redirect on rename. Bookmarks survive.
3. Archive is reversible and freezes writes. The normal path for a reorganized team.
4. Delete needs 7 days archived, then a 30 day restore window, then hard delete. No email can warn anyone; delay is the safeguard.
5. Platform admin may force transfer ownership. People leave the org.
6. Viewers read contacts. They already read the same PII in responses.
7. Viewers cannot export row-level data; aggregate exports are fine. Export is the irreversible bulk copy.
8. Token claim of a platform invite succeeds with a different email, flagged to the admin. Personal and work Google accounts are common.
9. Admin-minted password reset links, never stored, audited. No reliable SMTP.
10. Feature flags dropped; raw script kill switch lives in `workspace_limits`. One org, deploys are flags.
11. No impersonation. Keeps PII inside the department that collected it.
12. Abuse reports go to a table reviewed in `/admin`. No email channel exists.
13. Org privacy notice at `/privacy`, edited in app. One organization, one notice.
14. `platform_audit_log` is separate from `activity_log`. It must outlive deleted workspaces.

## Open questions for the owner

1. Who besides you gets platform admin? At least two is safer for reset links and abuse review.
2. Should workspace invite links optionally be restricted to the org's email domain (for example only `@org.example`)?
3. Is admin-assisted password reset acceptable long term, or will you add an auth-only SMTP sender?
4. Should workspace owners see abuse reports against their own surveys, or only platform admins?
5. Is a 7 day archive period before deletion right, or too slow for a department that wants data gone now?
6. Should the org privacy notice be drafted by legal or HR before launch, and who signs off edits?
7. Confirm `banner` as the default `pixel_consent_mode` (also asked in R7).
