# SQL security review: migrations 0001 to 0017, seed.sql, supabase/tests

Scope: `supabase/migrations/0001_extensions_enums.sql` through `0017_realtime.sql`, `supabase/seed.sql`, `supabase/tests/00` to `08`. Migration `0018_phase2_followups.sql` and `supabase/tests/09_phase2_followups.sql` were being edited by another agent during this review and are out of scope; any finding below may already be addressed or changed there. This was a read-only review. Every finding comes from reading the SQL. Where a finding also depends on TypeScript or Supabase platform behavior, the file is named, and anything that could not be confirmed from the SQL alone is marked PLAUSIBLE.

Reference intent: AGENTS.md (Data access), docs/00-decisions.md (Tenancy, Public pages, R1, R10), docs/01-data-model.md section 11, docs/02-public-delivery.md section 5.2.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| H-1 | High (PLAUSIBLE) | Platform invite claimed by email match without a verified email | 0004_signup_and_invites.sql:80-92, 111-131, 139-147 |
| M-1 | Medium | Plaintext resume secret stored in `submission_idempotency.result` and returned on replay | 0012_submission.sql:524-530, 706-719 |
| M-2 | Medium | Survey-wide rate limit bucket is consumed before per-IP checks and Turnstile (one IP can block any survey) | 0012_submission.sql:6-23; src/lib/public/submit.ts:187-191 |
| M-3 | Medium | `reports.survey_id` can be repointed at another workspace's survey (cross-tenant default report squatting) | 0013_reports_exports.sql:16, 303-304 |
| L-1 | Low (PLAUSIBLE) | Client-controlled `workspace_pixels.parsed` for every pixel type can bypass the raw script kill switch | 0010_pixels.sql:13, 26-40; 0011_public_read.sql:61-70 |
| L-2 | Low | Invite and share tokens are copied into `activity_log.diff` and kept for 400 days | 0003_workspaces.sql:190-191, 397-398; 0013_reports_exports.sql:70-71 |
| L-3 | Low | Share passwords use client-written MD5-crypt hashes readable by every editor | 0013_reports_exports.sql:42, 256-258, 317 |
| L-4 | Low | Cross-tenant oracles: `validate_contact_custom` and `workspace_slug_available` granted to any authenticated user | 0007_contacts.sql:152-196, 620; 0003_workspaces.sql:407-415 |
| L-5 | Low | Missing immutability guards: `contact_notes`, `contact_field_defs`, `contact_views.shared`, `reports.created_by`, `workspaces.pixel_notice_ack_by` | 0007_contacts.sql:645-647, 663-664, 671-673; 0013_reports_exports.sql:300-302; 0003_workspaces.sql:316-319 |
| L-6 | Low (PLAUSIBLE) | `contact_imports.storage_path` is not scoped to the workspace prefix | 0007_contacts.sql:132, 686-690; 0015_storage_jobs.sql:72-81 |
| L-7 | Low | Internal SECURITY DEFINER helpers rely only on default privileges; no test pins what `authenticated` may execute | 0001_extensions_enums.sql:33-39; 0017_realtime.sql:15-19 |
| L-8 | Low (PLAUSIBLE) | Realtime DELETE events on `responses` are not filtered by RLS | 0017_realtime.sql:6-13 |
| L-9 | Low | Rate limit window allowed up to 1 day but rows pruned after 2 hours; daily HMAC rotation resets counters | 0012_submission.sql:11; 0016_cron.sql:37-38 |
| L-10 | Low | Stale lock takeover does not bump `revision`; `save_draft` reads without a row lock | 0005_surveys.sql:443-445, 476-501 |
| L-11 | Low | `contact_duplicate_candidates` is quadratic and callable by any viewer | 0007_contacts.sql:445-490, 618 |
| L-12 | Low | Erasure gaps: unsalted email hash in the log, blocked while archived, exports and import CSVs untouched | 0014_privacy.sql:149, 210-212; 0003_workspaces.sql:131 |
| L-13 | Low | Admins can delete responses directly with no audit row and no counter adjustment | 0008_responses.sql:135 |
| I-1 | Info | `publish_survey_version` trusts the caller's public half; the server-only key walk runs before the size check | 0006_publish.sql:207-218 |
| I-2 | Info | Invite, respondent and share tokens are stored in plaintext | 0002_identity.sql:22; 0003_workspaces.sql:64; 0007_contacts.sql:77; 0013_reports_exports.sql:40 |
| I-3 | Info | Anon read path: no SQL throttle, alias dictionary enumeration, internal title fallback, old versions stay fetchable | 0011_public_read.sql:9-97 |
| I-4 | Info | `exports` storage read policy is wider than `export_jobs` row visibility | 0008_responses.sql:192-193; 0013_reports_exports.sql:325-326 |
| I-5 | Info | `logo_path` and `og_image_path` are free text returned to anon | 0003_workspaces.sql:13; 0005_surveys.sql:57; 0011_public_read.sql:59-60 |
| I-6 | Info | `profiles.display_name` and `avatar_url` are unbounded and self-writable; avatar comes from signup metadata | 0002_identity.sql:8-9; 0004_signup_and_invites.sql:117-123 |
| I-7 | Info | `shares_workspace` ignores deleted workspaces and profile status | 0003_workspaces.sql:136-142 |

Counts: 0 Critical, 1 High, 3 Medium, 13 Low, 7 Info.

---

## H-1. Platform invite claimed by email match without a verified email (PLAUSIBLE, High)

**What the code does.** `handle_new_user` (0004:111-131) runs after every insert into `auth.users` and calls `apply_invites(new.id, new.email, ...)`. Step 3 of `apply_invites` (0004:80-92) activates a pending profile when an open `platform_invites` row has the same email, and marks that invite used by the new user. `claim_pending_invite` (0004:139-147) and the other claim functions read `auth.users.email` the same way. None of these paths look at `email_confirmed_at` or at how the identity was verified. `supabase/config.toml:215` has `enable_confirmations = false`.

**Exploit.** Caller: anyone on the internet (no account). A platform admin invites `jane@dept.example.org` (0002:19-32, email-match invite). The attacker calls Supabase `signUp({ email: 'jane@dept.example.org', password: ... })` with the public anon key. With confirmations off, GoTrue inserts and auto-confirms the user; the trigger matches the invite and sets the profile to `active`. The attacker now holds an active profile under Jane's address, Jane's invite is consumed (`used_by` is the attacker), and Jane can no longer register that email. If the platform admin then picks "Jane" as owner in `admin_create_workspace` (0003:417-465, owner chosen by profile), the attacker owns a department workspace. With confirmations on, the trigger still fires at insert time (before the user confirms), so the invite is consumed by an unconfirmed row; that is a denial of service against the invitee even though the attacker cannot sign in.

**Why it matters.** The invite-only gate (docs/00 Tenancy) is the only thing between the internet and an active profile. Email match is meant to prove control of the mailbox; here it proves nothing.

**Confirm.** Check the production Auth settings for "Confirm email" and every enabled OAuth provider's email verification. If production also has confirmations off, this is directly exploitable.

**Fix.** Turn on email confirmations in production (with autoconfirm, `email_confirmed_at` is set at signup and no SQL check can help). Then only match on a verified email, and claim at confirmation time:

```sql
-- 0004 handle_new_user: pass the email only when it is already verified
perform apply_invites(new.id,
  case when new.email_confirmed_at is not null then new.email end,
  v_meta ->> 'workspace_invite_token', v_meta ->> 'platform_invite_token');

-- claim_pending_invite, claim_platform_invite, accept_workspace_invite
return apply_invites(v_uid,
  (select email from auth.users where id = v_uid and email_confirmed_at is not null),
  null, null);

-- claim when the address is confirmed later
create or replace function handle_user_email_confirmed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    begin
      perform apply_invites(new.id, new.email, null, null);
    exception when others then
      raise warning 'email confirm claim failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_email_confirmed();
```

Token claims (steps 1 and 2) can stay as they are; the token itself is the proof.

---

## M-1. Plaintext resume secret stored in `submission_idempotency.result` and returned on replay (Medium)

**What the code does.** On a `save` without a resume hash, `submit_response_core` mints `v_secret := gen_token(32)`, stores only `sha256_hex(v_secret)` on the response, and returns `resume_token: v_secret` (0012:524-530). The wrapper `submit_response` then stores that whole result in `submission_idempotency.result` (0012:716-719) and returns it again, unchanged, to any later call with the same `idempotency_key` and `survey_id` (0012:706-713). Rows live 24 hours (0016:39-40).

**Exploit.** Caller: anyone who can reach `/api/public/submit` (anon through the route, service role underneath). Inputs: a victim's `idempotencyKey` and the survey id. The idempotency key is not a secret: it is sent to Cloudflare in the Turnstile siteverify body (docs/02 line 240, src/lib/public/submit.ts:196), and it sits in request logs and browser storage. Replaying `{action: 'save', surveyId, idempotencyKey: <victim key>, ...}` returns the stored result, including the victim's resume secret. `POST /api/public/resume` with that secret returns the partial's answers (src/lib/public/resume.ts, `rowsToWire`), which can include name, email, phone and free text. The replay also skips every check in `submit_response_core`, because it returns before the core runs.

**Why it matters.** It contradicts the stated design ("only sha256_hex(secret) is stored", 0012:278-279) and turns a non-secret retry key into a bearer credential for PII.

**Fix.** Never persist the secret, and bind replays to the original respondent:

```sql
-- submit_response, after the core call
update submission_idempotency
   set result = v_result - 'resume_token',
       response_id = case when v_result ->> 'response_id' is not null then (v_result ->> 'response_id')::uuid end
 where key = v_idem;

-- on replay, require the same respondent_hash and mark the replay
alter table submission_idempotency add column respondent_hash text;
-- insert: values (v_idem, v_sid, left(nullif(p_payload ->> 'respondent_hash', ''), 64))
if v_prev.survey_id <> v_sid or v_prev.result is null
   or v_prev.respondent_hash is distinct from left(nullif(p_payload ->> 'respondent_hash', ''), 64) then
  return jsonb_build_object('ok', false, 'code', 'invalid_request');
end if;
return v_prev.result || jsonb_build_object('replayed', true);
```

A client whose first save response was lost will get a replay without `resume_token`; the next save simply starts a fresh partial, which is acceptable. Also stop sending the idempotency key to Turnstile, or send a hash of it.

---

## M-2. Survey-wide rate limit bucket consumed first (Medium)

**What the code does.** `rate_limit_hit` (0012:6-23) checks one bucket and records a hit whenever that bucket allows it. The submit route calls it once per rule, in order, and stops at the first refusal (src/lib/public/ratelimit.ts `checkRateLimits`). The first rule is `submit:survey` keyed by survey id, 600 per minute (src/lib/public/submit.ts:187); the per-IP rules come after it, and Turnstile only runs after all of them (submit.ts:194-198).

**Exploit.** Caller: anon, one IP, no captcha. Send 600 POSTs per minute to `/api/public/submit` for an open survey with any well-formed body (for example `action: 'save'` and a syntactically valid but bogus `resumeToken`). Each request passes and records `submit:survey` before failing the per-IP rule or Turnstile. After 600 requests every real respondent gets `429 rate_limited` for the rest of the minute. Repeat forever. The survey id is public (`resolve_public_survey` returns it).

**Why it matters.** Any open survey can be taken offline by one client without solving a captcha. Docs/02 5.2 intends the survey bucket as a flood guard, not a single point of failure.

**Fix.** Check all buckets atomically and record only when all pass, then order per-IP buckets first and count the survey bucket only for captcha-verified requests:

```sql
create or replace function rate_limit_hit_all(p_checks jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c jsonb;
  n int;
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks) not between 1 and 8 then
    raise exception 'invalid_rate_limit_arguments';
  end if;
  if exists (select 1 from jsonb_array_elements(p_checks) x
             where length(x ->> 'bucket') > 64 or length(x ->> 'key') > 200
                or (x ->> 'window')::interval not between interval '1 second' and interval '2 hours'
                or (x ->> 'max')::int < 1) then
    raise exception 'invalid_rate_limit_arguments';
  end if;
  -- one lock per key, stable order, no deadlocks
  perform pg_advisory_xact_lock(hashtextextended(s.b || ':' || s.k, 0))
    from (select x ->> 'bucket' as b, x ->> 'key' as k from jsonb_array_elements(p_checks) x order by 1, 2) s;
  for c in select value from jsonb_array_elements(p_checks) loop
    select count(*) into n from rate_limit_events
     where bucket = c ->> 'bucket' and key = c ->> 'key' and at > now() - (c ->> 'window')::interval;
    if n >= (c ->> 'max')::int then
      return jsonb_build_object('ok', false, 'bucket', c ->> 'bucket', 'window', c ->> 'window');
    end if;
  end loop;
  insert into rate_limit_events (bucket, key)
  select x ->> 'bucket', x ->> 'key' from jsonb_array_elements(p_checks) x;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rate_limit_hit_all(jsonb) from public, anon, authenticated;
grant execute on function rate_limit_hit_all(jsonb) to service_role;
```

In the route, call it once with the per-IP rules, then after Turnstile succeeds call it again with `submit:survey` only.

---

## M-3. `reports.survey_id` can be repointed across tenants (Medium)

**What the code does.** `reports_insert` checks that `survey_id` belongs to the row's workspace (0013:300-302), but `reports_update` only checks `is_member(workspace_id, 'editor')` (0013:303-304). There is no guard trigger on `reports`, so `survey_id` and `is_default` can be changed freely. The partial unique index `reports_one_default on reports (survey_id) where is_default` (0013:16) spans all workspaces.

**Exploit.** Caller: an editor of workspace A. Get workspace B's survey id from `resolve_public_survey('<B slug>')` (anon, returns `survey_id`). Then, with the normal user client:

```sql
update reports set survey_id = '<B survey id>', is_default = true where id = '<A report id>';
```

The FK is satisfied, RLS passes (workspace_id is still A). B's editors can never see this row, but when they click "Customize" on the default report, src/app/(dashboard)/w/[slug]/surveys/[id]/reports/actions.ts finds no default (RLS hides A's row) and its insert fails on `reports_one_default`. B's default report can never be materialized. Also, if B deletes the survey, A's report is cascade deleted. No B data leaks: `shared_report_payload` refuses mismatched workspaces (0013:263) and the dashboard reads through RLS.

**Why it matters.** A member of one tenant can break a feature of, and plant rows linked to, another tenant. The same class of bug exists wherever a denormalized `workspace_id` is not tied to the parent row (see L-5).

**Fix.** Make the pairing structural with composite foreign keys, which also covers the other denormalized tables:

```sql
alter table surveys add constraint surveys_id_ws unique (id, workspace_id);
alter table reports drop constraint reports_survey_id_fkey;
alter table reports add constraint reports_survey_ws_fk
  foreign key (survey_id, workspace_id) references surveys (id, workspace_id) on delete cascade;

-- and a guard so ids and authorship never move
create or replace function guard_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not is_trusted_caller() then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.survey_id <> old.survey_id
     or new.created_by is distinct from old.created_by then
    raise exception 'workspace_id, survey_id and created_by are immutable on a report';
  end if;
  return new;
end $$;
create trigger reports_guard before insert or update on reports
  for each row execute function guard_report();

-- find rows already planted
select r.id, r.workspace_id, s.workspace_id as survey_ws
from reports r join surveys s on s.id = r.survey_id
where s.workspace_id <> r.workspace_id;
```

Apply the same composite FK pattern to `respondent_tokens (survey_id, workspace_id)` and `(contact_id, workspace_id)`, `contact_notes (contact_id, workspace_id)`, `report_widgets (report_id, workspace_id)`, `report_shares (report_id, workspace_id)` after adding `unique (id, workspace_id)` on `contacts` and `reports`.

---

## L-1. `workspace_pixels.parsed` is client-controlled for every type (Low, PLAUSIBLE)

**What the code does.** `parsed jsonb` (0010:13) is described as "custom_script parsed into script/noscript parts at save", but the admin writes it directly through `workspace_pixels_insert`/`_update` (0010:66-68). `guard_workspace_pixel` (0010:26-40) enforces the kill switch only for `type in ('custom_script','gtm')` and never touches `parsed`. `resolve_public_survey` returns `parsed` for every pixel type to anon (0011:61-70).

**Exploit.** Caller: a workspace admin in a workspace where a platform admin set `raw_script_pixels_allowed = false`. Insert `{type: 'ga4', value: 'G-ABCD1234', parsed: {"script": "<arbitrary JS>"}}`. The guard allows it (type is ga4). If the public renderer ever reads `parsed` without checking `type` (the renderer is not built yet; no consumer of `parsed` exists in src/), arbitrary script runs on public pages despite the kill switch.

**Fix.** Server-own `parsed` and only return it for custom scripts:

```sql
-- guard_workspace_pixel, before the kill switch check
if new.type <> 'custom_script' then
  new.parsed := null;
end if;

-- resolve_public_survey, pixels element
jsonb_build_object('id', p.id, 'type', p.type, 'value', p.value,
                   'parsed', case when p.type = 'custom_script' then p.parsed end)
```

Better still, parse `custom_script` in a SECURITY DEFINER function and refuse client-written `parsed` (`if not is_trusted_caller() and not flag_on('survey.internal') then new.parsed := null; end if;`).

---

## L-2. Tokens copied into `activity_log` (Low)

**What the code does.** `log_activity` skips only `updated_at, created_at, definition, parsed, password_hash, storage_bytes_used, storage_reconciled_at` (0003:190-191). It is attached to `workspace_invites` (0003:397-398) and `report_shares` (0013:70-71). On INSERT the diff contains `token`. `activity_log` rows are pruned after 400 days (0016:47-48), so a token outlives revocation in the log.

**Exploit.** No new audience today: admins can already read `workspace_invites` and `report_shares`. It matters for any future export of activity logs, support access, or a later relaxation of `activity_log_select`.

**Fix.**

```sql
-- in log_activity
v_skip text[] := array['updated_at','created_at','definition','parsed','password_hash',
                       'storage_bytes_used','storage_reconciled_at','token'];
-- clean existing rows
update activity_log set diff = diff - 'token' where entity in ('invite', 'share') and diff ? 'token';
```

---

## L-3. Share passwords: weak hash format, readable by editors (Low)

**What the code does.** `report_shares.password_hash` (0013:42) is written by the client. src/lib/analytics/password.ts writes MD5-crypt (`$1$`). `shared_report_payload` verifies with `extensions.crypt` (0013:256-258). `report_shares_select` lets every editor read the hash (0013:317), and src/lib/analytics/data.ts selects it.

**Exploit.** Any editor can read all share password hashes and crack MD5-crypt offline far faster than bcrypt. Payloads are aggregates with small-cell suppression, so impact is limited. The share route does rate limit password tries (src/lib/analytics/share.ts:67).

**Fix.** Hash in SQL with bcrypt and stop exposing the column:

```sql
create or replace function set_report_share_password(p_share_id uuid, p_password text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from report_shares where id = p_share_id for update;
  if v_ws is null or not is_member(v_ws, 'editor') then
    raise exception 'not_authorized';
  end if;
  if p_password is not null and length(p_password) not between 8 and 200 then
    raise exception 'invalid_password';
  end if;
  perform set_config('survey.internal', 'on', true);
  update report_shares
     set password_hash = case when p_password is null then null
                              else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end
   where id = p_share_id;
  perform set_config('survey.internal', 'off', true);
end $$;
grant execute on function set_report_share_password(uuid, text) to authenticated;

alter table report_shares add column has_password boolean generated always as (password_hash is not null) stored;
revoke select (password_hash) on report_shares from authenticated;
-- and in guard_report_share: refuse client writes to password_hash
```

The column revoke requires the TypeScript to stop selecting `password_hash` (use `has_password`).

---

## L-4. Cross-tenant oracles granted to any authenticated user (Low)

**What the code does.** `validate_contact_custom(p_workspace_id, p_custom)` is SECURITY DEFINER with no caller check and is granted to `authenticated` (0007:152-196, 620). It reads `contact_field_defs` for any workspace and raises distinct messages for "unknown field", wrong type, and wrong select option. `workspace_slug_available(p_slug, p_workspace_id)` (0003:407-415) is also definer and granted to `authenticated` with no check, including pending profiles.

**Exploit.** Caller: any signed-in user, even `pending`. Workspace ids are public: `resolve_public_survey` returns `logo_path` and `og_image_path`, which start with `{workspace_id}/` (0003:13, 0005:57). Calling `validate_contact_custom('<B id>', '{"salary": 1}')` reveals whether B tracks a `salary` field and its type; repeated calls with candidate strings reveal B's select options. `workspace_slug_available` confirms which department slugs exist.

**Fix.** Both are only needed inside definer functions and triggers, which run as the owner, so revoke them:

```sql
revoke execute on function validate_contact_custom(uuid, jsonb) from authenticated;
-- keep a live slug check only for those who can use the answer
create or replace function workspace_slug_available(p_slug text, p_workspace_id uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when not (is_trusted_caller() or is_platform_admin()
                        or (p_workspace_id is not null and is_member(p_workspace_id, 'admin')))
              then null
         else not exists (select 1 from workspaces where slug = p_slug and id is distinct from p_workspace_id)
              and not exists (select 1 from workspace_slug_history h where h.slug = p_slug
                              and (h.workspace_id is null or p_workspace_id is null or h.workspace_id <> p_workspace_id)) end;
$$;
```

`admin_create_workspace` and `rename_workspace_slug` call it as definer, so they are unaffected.

---

## L-5. Missing immutability guards on several client-writable tables (Low)

Each item verified in the SQL; none leaks another tenant's data today, but each breaks an invariant the docs state.

1. `contact_notes` (0007:645-647): the author can `update contact_notes set contact_id = '<any contact>', workspace_id = '<another workspace where they are editor>'`. The insert policy's same-workspace check (0007:642-644) is not repeated on update and there is no guard trigger.
2. `contact_field_defs` (0007:663-664): an editor can change `key` (comment at 0007:91 says "never changes"), `type`, and `workspace_id`. Changing `key` orphans every `contacts.custom` value; changing `type` makes stored values fail validation on the next edit.
3. `contact_views` (0007:671-673): a viewer may create only personal views (0007:668-670), but the update policy's `created_by = auth.uid() and is_member(workspace_id)` branch lets that viewer flip `shared = true`, publishing a view to the whole workspace, which docs/01 section 11 reserves for editors.
4. `reports.created_by` and `survey_templates.created_by` are not forced to `auth.uid()` on insert (0013:300-302, 0005:541-543), so authorship can be spoofed.
5. `workspaces.pixel_notice_ack_by` (0003:316-319) is overwritten with `auth.uid()` only when `pixel_notice_ack_at` changes; an admin can set `pixel_notice_ack_by` to any profile id while leaving the timestamp, falsifying who accepted responsibility for `notice` mode.

**Fix.**

```sql
create or replace function guard_contact_note() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.workspace_id <> old.workspace_id or new.contact_id <> old.contact_id or new.author is distinct from old.author then
    raise exception 'workspace_id, contact_id and author are immutable on a note';
  end if;
  return new;
end $$;
create trigger contact_notes_guard before update on contact_notes for each row execute function guard_contact_note();

create or replace function guard_contact_field_def() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.workspace_id <> old.workspace_id or new.key <> old.key or new.type <> old.type then
    raise exception 'workspace_id, key and type are immutable; archive and create a new field';
  end if;
  return new;
end $$;
create trigger contact_field_defs_guard before update on contact_field_defs for each row execute function guard_contact_field_def();

drop policy contact_views_update on contact_views;
create policy contact_views_update on contact_views for update to authenticated
  using ((created_by = auth.uid() and is_member(workspace_id)) or (shared and is_member(workspace_id, 'editor')))
  with check ((not shared and created_by = auth.uid() and is_member(workspace_id))
              or (is_member(workspace_id, 'editor') and (shared or created_by = auth.uid())));

-- survey_templates and reports insert: add "and created_by = auth.uid()" to the with check,
-- or force it in a before insert trigger as guard_report does in M-3.

-- guard_workspace_lifecycle, inside the client branch
if new.pixel_notice_ack_by is distinct from old.pixel_notice_ack_by
   and new.pixel_notice_ack_at is not distinct from old.pixel_notice_ack_at then
  raise exception 'pixel_notice_ack_by is set by the system';
end if;
```

---

## L-6. `contact_imports.storage_path` is not scoped (Low, PLAUSIBLE)

**What the code does.** `contact_imports_insert` (0007:686-690) lets an editor set `storage_path` to any text. `storage_sweep_batch` (0015:72-81) later enqueues deletion of that path in the `imports` bucket after 30 days. The import job that will read the CSV (service role, "service role read" per 0008:195) is not implemented yet in src/.

**Exploit.** Caller: editor of A. Insert a `contact_imports` row with `storage_path = 'imports/<B workspace id>/<B import id>.csv'`. If the import job reads `storage_path` with the service role, A imports B's CSV; in any case the sweep deletes B's file after 30 days. Requires B's import uuid, which is not public, hence Low.

**Fix.**

```sql
alter table contact_imports add constraint contact_imports_path_scoped check (
  storage_path is null
  or (storage_object_name('imports', storage_path) like workspace_id::text || '/%'
      and storage_path !~ '\.\.'));
```

---

## L-7. Internal definer helpers depend on default privileges only (Low)

**What the code does.** 0001:33-39 revokes the default EXECUTE grant for functions created by the migration role, and 0017:15-19 re-sweeps `public, anon` but not `authenticated`. Internal helpers such as `apply_invites(uuid, text, text, text)` (0004:17), `write_activity(...)` (0003:264), `write_platform_audit(...)` (0002:86), `create_builtin_contact_views(uuid)` (0007:312), `find_or_create_contact_by_email` (0012:58), `report_widget_data` (0013:163), `rollup_old_events`, `reconcile_storage_bytes` (0016) have no explicit revoke. They are safe today only because the CLI runs migrations as `postgres`, whose defaults 0001 altered. Test 01 checks anon only.

**Exploit (if the defaults are ever bypassed, for example a function recreated from the Studio SQL editor as another role).** `apply_invites('<victim uuid>', null, '<leaked invite token>', null)` adds a different user to a workspace; `write_activity('<any ws>', ...)` forges audit rows in any tenant; `create_builtin_contact_views('<any ws>')` writes into any tenant.

**Fix.** Explicit revokes plus a test that pins the authenticated allowlist:

```sql
revoke execute on function apply_invites(uuid, text, text, text), write_activity(uuid, text, uuid, text, jsonb),
  write_platform_audit(text, text, uuid, jsonb), create_builtin_contact_views(uuid),
  find_or_create_contact_by_email(uuid, text, text), follow_contact(uuid), contact_family(uuid),
  report_widget_data(uuid, jsonb, text, text), submit_response_core(jsonb, text),
  validate_survey_definition(jsonb, uuid), rollup_old_events(), reconcile_storage_bytes()
  from public, anon, authenticated;

-- supabase/tests: authenticated may execute exactly this list
select array_agg(p.proname::text order by p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE');
-- assert it equals the reviewed allowlist
```

---

## L-8. Realtime DELETE events on `responses` (Low, PLAUSIBLE)

**What the code does.** 0017:6-13 adds `public.responses` to `supabase_realtime`. Supabase documents that Postgres Changes cannot apply RLS to DELETE events; with RLS enabled the old record carries only the primary key.

**Exploit.** Caller: any signed-in user (any workspace). Subscribe to `postgres_changes` on `public.responses` with event `DELETE`. When retention, erasure, survey deletion or an admin deletes responses in any workspace, the subscriber receives the deleted response ids and timing. Low value, but cross-tenant.

**Confirm.** Subscribe as a user of workspace A, delete a response in B, observe whether the event arrives (and whether anon, which has no SELECT grant, receives anything).

**Fix.** Subscribe only to INSERT and UPDATE in the client, and move the dashboard feed to Realtime Broadcast on private per-workspace channels authorized by an RLS policy on `realtime.messages`, or keep `responses` out of the publication and publish from a trigger: `perform realtime.send(jsonb_build_object('id', new.id), 'response', 'ws:' || new.workspace_id, true);`.

---

## L-9. Rate limit window versus pruning, and key rotation (Low)

**What the code does.** `rate_limit_hit` accepts `p_window` up to 1 day (0012:11), but the cron job deletes rows older than 2 hours (0016:37-38), so any window over 2 hours silently counts fewer hits than intended. Today's longest window is 1 hour, so this is latent. Separately, the IP key is `HMAC(ip, secret + utcDate)` (src/lib/public/ratelimit.ts), so every per-IP counter resets at 00:00 UTC; a client can get up to twice the limit across midnight. Rotating `RATE_LIMIT_SECRET` resets every counter. Truncation of the unlogged table on crash also resets counters (accepted in docs/02).

**Fix.** Keep the two bounds in one place:

```sql
-- 0012 rate_limit_hit
or p_window > interval '2 hours'
-- or change the prune job to: where at < now() - interval '25 hours'
```

Accept the midnight reset or key the HMAC on a rolling 2 day window (check both today's and yesterday's key and sum).

---

## L-10. Draft lock: stale takeover and unlocked read in `save_draft` (Low)

**What the code does.** `take_draft_lock` takes over a lock older than 15 minutes without bumping `revision` (0005:443-445); only the forced path bumps it (0005:448). `save_draft` reads the version without `for update` (0005:476), checks the lock on that snapshot (0005:483-485), then updates where `revision = p_expected_revision` (0005:498-501).

**Exploit.** Editor A's lock is 14 minutes 59 seconds old. A starts `save_draft`; between its read and its update, editor B takes the stale lock (no revision bump) and commits. A's update still matches the revision and succeeds, refreshing `locked_at` while `locked_by` is B. B's next save fails with `revision_conflict`. No data from outside the workspace is involved; this is an integrity and confusion issue between two editors.

**Fix.**

```sql
-- save_draft
select * into v from survey_versions where id = p_version_id for update;
-- take_draft_lock, stale branch
update survey_versions set locked_by = v_uid, locked_at = now(),
       revision = revision + case when v.locked_by is not null and v.locked_by <> v_uid then 1 else 0 end
 where id = p_version_id returning * into v;
```

---

## L-11. `contact_duplicate_candidates` is quadratic and open to viewers (Low)

**What the code does.** SECURITY INVOKER, granted to `authenticated` (0007:618). The `similar_email` branch joins every live contact to every other contact with the same domain and computes `similarity()` per pair (0007:479-482); `limit 500` applies after all pairs are built and deduplicated (0007:484-489).

**Exploit.** A viewer of a workspace with 50,000 contacts on one domain triggers about 1.25 billion trigram comparisons per call and can call it in a loop. Supabase's default `statement_timeout` for `authenticated` (8 seconds) bounds each call but not the aggregate load.

**Fix.**

```sql
-- at the top of the function body
if not is_member(p_workspace_id, 'editor') then
  raise exception 'not_authorized';
end if;
alter function contact_duplicate_candidates(uuid) set statement_timeout = '5s';
-- and bound the similar_email branch with an index-assisted predicate
-- (a.local_part operator(extensions.%) b.local_part) using a gin_trgm_ops index on split_part(email,'@',1)
```

---

## L-12. Erasure gaps (Low)

**What the code does.**
1. `erase_respondent` logs `email_sha256 = sha256_hex(c.email)` (0014:212). An unsalted SHA-256 of an email is reversible by dictionary for any known address, so the "erased" person stays identifiable in `activity_log` for 400 days.
2. Authorization uses `is_member(c.workspace_id, 'admin')` (0014:149), which is false while the workspace is archived (0003:131). Erasure requests cannot be honored for an archived workspace by anyone, including platform admins.
3. Export files in the `exports` bucket (kept 7 days) and import CSVs in `imports` (kept 30 days) that contain the person are not enqueued.

**Fix.**

```sql
-- 1. drop the hash or key it with a server secret held outside the database
'email_sha256', null
-- 2. allow admins of archived workspaces and platform admins
if c.id is null or not (caller_role(c.workspace_id) in ('owner', 'admin') or is_platform_admin()) then
  raise exception 'not_authorized';
end if;
-- 3. document that exports and imports are covered by their 7 and 30 day expiry, or enqueue them:
insert into storage_deletions (bucket, path, workspace_id, reason)
select 'exports', storage_object_name('exports', storage_path), workspace_id, 'erase'
from export_jobs where workspace_id = c.workspace_id and storage_path is not null;
```

---

## L-13. Direct response deletion by admins (Low)

**What the code does.** `responses_delete` (0008:135) lets an admin delete responses with a plain `DELETE`. There is no activity row, `surveys.complete_count` and `contacts.response_count` are not adjusted, and the `response_files` trigger enqueues files with reason `orphan` (0008:111) because no `survey.deletion_reason` is set.

**Fix.** Drop the policy and route deletions through a function:

```sql
drop policy responses_delete on responses;
create or replace function delete_responses(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ws uuid; v_n int;
begin
  if cardinality(p_ids) not between 1 and 500 then raise exception 'invalid_ids'; end if;
  select min(workspace_id::text)::uuid into v_ws from responses where id = any (p_ids);
  if v_ws is null or not is_member(v_ws, 'admin')
     or exists (select 1 from responses where id = any (p_ids) and workspace_id <> v_ws) then
    raise exception 'not_authorized';
  end if;
  perform set_config('survey.deletion_reason', 'erase', true);
  delete from responses where id = any (p_ids);
  get diagnostics v_n = row_count;
  perform write_activity(v_ws, 'response', null, 'delete', jsonb_build_object('count', v_n));
  return v_n;
end $$;
grant execute on function delete_responses(uuid[]) to authenticated;
```

---

## I-1. Publish trusts the caller's public half (Info)

`publish_survey_version` accepts `p_public_definition` from the client and only scans it for server-only keys (0006:207-214). It is never compared with `definition`, so an editor calling the RPC directly can publish a public page that differs from the server definition the validator uses; scored calculations and scored `set_ending` rules are not detectable by key (0006:7-8). The recursive key walk (0006:211) runs before the size check (0006:216-218). Editors are trusted authors, so this is Info. Move the size check before the walk and consider computing the split in SQL or storing a hash of the TS split for audit.

## I-2. Plaintext token storage (Info)

`platform_invites.token` (0002:22), `workspace_invites.token` (0003:64), `respondent_tokens.token` (0007:77), `report_shares.token` (0013:40) are stored and compared in plaintext so the UI can show links again. Entropy is sound (`gen_token` 16 to 24 bytes, 0001:56-63). A database read (backup, support query, `select *` by an editor) yields working links. If re-display is not needed, store `sha256_hex(token)` and look up by hash, as responses already do for resume secrets.

## I-3. Anon read path (Info)

`resolve_public_survey` and `get_public_definition` behave as specified: unknown, draft, archived and deleted-workspace keys all return zero rows from the same query shape, so there is no useful timing or existence oracle for slugs. Points to note: the anon key is public, so both functions are callable directly through PostgREST with no SQL throttle and `get_public_definition` returns up to 1 MB per call; aliases are human words and can be dictionary enumerated, and closed surveys still resolve (title, workspace name, closed message); `title` falls back to the internal `surveys.title` when the public definition has none (0011:58); any older published version stays fetchable by version id (0011:83-93), so content removed in a later version is not withdrawn. The `workspace_archived` reason is visible to anon.

## I-4. Exports storage read is wider than job visibility (Info)

`export_jobs_select` limits jobs to their creator or admins (0013:325-326), but `"exports editor read"` (0008:192-193) lets any editor list and download every object under `exports/{workspace_id}/`. Editors can read the underlying rows anyway, so this is consistency, not exposure.

## I-5. Free text asset paths (Info)

`workspaces.logo_path` (0003:13) and `surveys.og_image_path` (0005:57) are unconstrained text, returned to anon (0011:59-60). Add `check (logo_path is null or logo_path like id::text || '/%')` and the equivalent `workspace_id` prefix check on `og_image_path` so the public page can only point at the tenant's own assets.

## I-6. Profile fields (Info)

`profiles.display_name` and `avatar_url` have no length or scheme checks (0002:8-9) and are self-updatable (0002:131-133); `handle_new_user` copies `avatar_url`/`picture` from signup metadata (0004:123). Add `check (length(display_name) between 1 and 80)` and `check (avatar_url is null or avatar_url ~ '^https://')`. `handle_new_user` correctly ignores any role or admin flag in metadata.

## I-7. `shares_workspace` scope (Info)

`shares_workspace` (0003:136-142) does not exclude deleted workspaces or inactive profiles, so a user still listed in a deleted workspace keeps reading co-members' profiles (including `status` and `is_platform_admin`). Join `workspaces` and require `w.deleted_at is null`.

---

## Checked and found sound

1. **SQL injection.** No `execute`, `format()`, `quote_ident` or string-built SQL exists in 0001 to 0017 or seed.sql. `search_contacts` (0007:368-441), `filtered_responses` (0013:110-152), `report_widget_data`, `import_contacts_chunk` and `validate_contact_custom` use filter jsonb and custom field keys only as values and jsonb operator arguments, never as identifiers. Casts on filter values can raise errors but cannot change the query.
2. **SECURITY DEFINER hygiene.** Every definer function pins `search_path = public, pg_temp`; extension functions are schema qualified. Every definer function granted to `authenticated` checks the caller (`is_member` with the right role, `caller_role`, `is_platform_admin`, or `auth.uid()`), derives the workspace from the target row rather than trusting a parameter (`set_survey_alias`, `take_draft_lock`, `save_draft`, `publish_survey_version`, `delete_survey`, `set_contact_custom`, `import_contacts_chunk`, `merge_contacts`, `erase_respondent`, `export_respondent_data`), and service-only functions check `is_service_role()` and are granted only to `service_role` (0012, 0015). Exceptions are listed in L-4 and L-7.
3. **RLS coverage.** All 40 tables have RLS enabled; there are no views or materialized views. All 94 policies were read; every UPDATE policy has a WITH CHECK. Tables with no write policy (`responses` insert/update, `answers`, `questions`, `survey_versions` insert, `storage_deletions`, `submission_idempotency`, `rate_limit_events`, `platform_audit_log`, `abuse_reports` insert) are write-protected for `authenticated`. Column guards on `surveys`, `survey_versions`, `questions`, `workspaces`, `workspace_members`, `workspace_invites`, `contacts`, `respondent_tokens`, `contact_views`, `workspace_pixels`, `report_shares` block moving rows between tenants. Gaps are M-3 and L-5.
4. **Anon surface.** 0001:33-39 plus 0017:15-19 leave anon with no table, view or sequence privilege in `public` and EXECUTE on exactly `resolve_public_survey` and `get_public_definition`; test 01 asserts both. Both functions return only branding, state, OG fields, the public half of a published definition and enabled pixels, never closed or draft content, and `get_public_definition` requires the key and a published version of that survey. Storage gives anon only public-URL reads of `public-assets` (no list policy).
5. **Response cap (R10).** `submit_response_core` locks the survey row `for update` (0012:319) and increments `complete_count` with a conditional update in the same transaction (0012:465-471). Concurrent completes cannot exceed the cap.
6. **Respondent token `max_responses`.** The token row is locked `for update` (0012:341-342) under the survey lock, completes are counted, and `used_count` is incremented in the same transaction (0012:663-665).
7. **Invite `max_uses`.** `apply_invites` selects the invite `for update of i` with `used_count < max_uses` in the WHERE (0004:41-46); READ COMMITTED rechecks the predicate on the locked row, and the table check `used_count <= max_uses` (0003:73) is a backstop.
8. **`rate_limit_hit` atomicity.** A transaction advisory lock on the bucket and key serializes count and insert (0012:15-21); it is granted to `service_role` only. Ordering across buckets is M-2.
9. **Resume tokens.** 32 random bytes, only `sha256_hex` stored on `responses`, cleared on complete and after 30 days (0012:526-527, 660; 0016:43-45). The leak via idempotency is M-1.
10. **Privilege escalation.** Editors cannot change roles (update policy needs admin); admins cannot promote to or demote from admin, cannot touch the owner row, and cannot remove an owner (0003:334-365, 711-717); exactly one owner is enforced by `workspace_one_owner` (0003:58) and the `survey.owner_write` flag. `is_platform_admin` and `status` changes are refused for non platform admins by `profiles_guard` (0002:99-119). `handle_new_user` reads only names, avatar and invite tokens from metadata. Claim functions need 192-bit tokens. Guard flags are transaction local and no client-callable function sets a flag before running caller-chosen DML.
11. **Data destruction.** `delete_survey` requires admin of the survey's own workspace; `merge_contacts` requires every contact in the survivor's workspace (0014:36-39); `erase_respondent` and `export_respondent_data` authorize on the resolved contact's workspace; `retention_batch`, `storage_sweep_batch`, `complete_storage_deletions`, `workspace_purge_due` and `purge_workspace` are service role only, and purge also requires the 30 day window in both the function and the delete trigger (0003:277-283). No function deletes by a caller-supplied workspace id without first proving membership.
12. **Storage policies.** All `storage.objects` policies are bucket scoped and authorize on the first path segment parsed as a uuid (0008:159-197); the logo path needs admin.
13. **Report shares.** 128-bit tokens, revoked and expired shares and wrong passwords all return null, and `shared_report_payload` refuses a share whose report points at another workspace's survey (0013:263). Counts under 3 are suppressed.
14. **Bounded loops.** `follow_contact` and the merge chain walks stop at 10 hops; `contact_family` uses `union`, which terminates; `record_events` caps at 50 events and 2 KB meta; `import_contacts_chunk` caps at 500 rows; `search_contacts` caps at 200 rows; `rate_limit_hit` bounds key length and window.
15. **Seed.** seed.sql only inserts the settings singleton and backfills built-in views; the first platform admin is promoted by hand as `postgres`, which the profile guard allows only for sessions without a JWT.

## What the SQL tests do not assert (and should)

1. The exact list of functions `authenticated` may execute (L-7), and that internal helpers (`apply_invites`, `write_activity`, `write_platform_audit`, `create_builtin_contact_views`, `report_widget_data`) are denied.
2. Cross-tenant attempts for every authenticated RPC: an editor of A calling `create_survey`, `set_survey_alias`, `save_draft`, `publish_survey_version`, `set_contact_custom`, `import_contacts_chunk`, `merge_contacts`, `export_respondent_data` and `erase_respondent` with B's ids must get `not_authorized`.
3. Cross-tenant updates through RLS: repointing `reports.survey_id` (M-3), `contact_notes.contact_id` and `workspace_id`, `contact_field_defs.key` and `workspace_id`, and a viewer flipping `contact_views.shared` (L-5).
4. Profile guard: a user updating their own `is_platform_admin` or `status` is refused; signup metadata containing `is_platform_admin`, `role` or `status` has no effect.
5. Invite claims: expired, revoked, exhausted and archived-workspace invites return `invalid`; a disabled profile returns `disabled`; email match does not fire for an unconfirmed email (H-1).
6. Idempotency replay of a `save` does not return a `resume_token` and is refused for a different `respondent_hash` (M-1).
7. Storage policies: a member of A cannot read, write or delete objects under B's prefix in each bucket, and an editor cannot overwrite the logo.
8. Anon outside `public`: no privileges on `storage.objects` beyond public URLs, and no Realtime events (L-8).
9. Pixels: kill switch also blocks script content placed in `parsed` of a non script pixel (L-1).
10. Concurrency cases (cap, token, invite) cannot be expressed in single-session psql tests; add a small pgbench or two-connection script for `submit_response` at the cap and for `accept_workspace_invite` at `max_uses`.
