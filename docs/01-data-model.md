# 01. Data model

Schema, RLS, versioning, response storage, respondent identity, contacts, and every table proposed by the other docs. Builds on `00-decisions.md` (including its "Reconciliation, 2026-10-21" rulings). Per R11 this doc is the single schema source: docs 02 to 05 may show SQL as illustration, but names and types here win. Where this doc picks something 00 left open, it is listed under "Decisions made here".

Conventions (from Fresno Skillshare and 559flawless):

- Every table has RLS enabled. Authorization lives in policies and `security definer` functions with `set search_path = public`. Route guards are UX only.
- Helpers come after the tables they read (a `language sql` body is validated at create time).
- Privileged state changes that a policy would otherwise allow are clamped by a `before update` guard trigger. Internal functions that must bypass a guard raise a transaction-local flag with `set_config('survey.<flag>', 'on', true)`. Clients cannot set custom GUCs through PostgREST.
- The `anon` role has no table grants at all and may execute exactly two functions (section 11). Supabase grants `execute` on new public functions to `anon` and `authenticated` by default, so migration 0001 runs `alter default privileges in schema public revoke execute on functions from public, anon, authenticated` and `revoke all on all tables in schema public from anon`, and every function is granted explicitly.
- Internal-only functions get no grants. Service-role-only functions get `grant execute ... to service_role` and nothing else.
- Migrations are numbered and never edited after they are applied. Regenerate `src/types/database.ts` after each one; row shapes are `type` aliases, not `interface`.
- `updated_at` is maintained by a shared `touch_updated_at()` trigger.
- Tables proposed by another doc are marked with that doc in a comment (`-- doc 02`).

## 1. Enums and extensions

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid, digest, gen_random_bytes, crypt
create extension if not exists pg_trgm;    -- duplicate contact detection (doc 04)
create extension if not exists pg_cron;    -- pure SQL housekeeping only (section 13)

-- Declaration order is the role order, so `role >= 'editor'` works.
create type workspace_role     as enum ('viewer', 'editor', 'admin', 'owner');
create type profile_status     as enum ('pending', 'active', 'disabled', 'deleted');  -- disabled = deactivated by a platform admin (doc 05)
create type survey_state       as enum ('draft', 'open', 'closed', 'scheduled');
create type version_status     as enum ('draft', 'published');
create type response_status    as enum ('partial', 'complete');
create type lead_status        as enum ('new', 'contacted', 'qualified', 'customer', 'lost');
create type pixel_type         as enum ('ga4', 'meta', 'gtm', 'custom_script');      -- doc 02
create type pixel_consent_mode as enum ('banner', 'notice', 'in_form');              -- R7
```

## 2. Identity and tenancy

```sql
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null default 'New user',
  avatar_url        text,
  status            profile_status not null default 'pending',
  is_platform_admin boolean not null default false,
  last_workspace_id uuid,                      -- where `/` lands; fk added after workspaces
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- guard_profile_privileges(): non platform admins cannot change status or is_platform_admin;
-- setting status = 'disabled' is refused while the user owns any workspace (transfer first).

create table platform_invites (                -- claimable by email match or by token link
  id          uuid primary key default gen_random_uuid(),
  email       text check (email is null or email = lower(btrim(email))),
  token       text not null unique default gen_token(24),   -- link: /invite/{token}
  note        text,
  invited_by  uuid references profiles(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '30 days',
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid references profiles(id) on delete set null
);
create unique index platform_invites_email_open on platform_invites (email)
  where email is not null and used_at is null and revoked_at is null;

create table platform_settings (               -- singleton, organization privacy notice
  id                 boolean primary key default true check (id),
  privacy_notice_md  text not null default '',
  updated_by         uuid references profiles(id) on delete set null,
  updated_at         timestamptz not null default now()
);

create table workspaces (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (length(btrim(name)) between 1 and 80),
  slug                   text not null unique check (
                           slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40
                           and slug not in ('admin','api','app','auth','new','settings','welcome','pending',
                                            'invite','join','privacy','report','s','w','r')),   -- doc 05
  logo_path              text,                -- public-assets/{workspace_id}/logo-{hash}.{ext}
  default_theme          jsonb not null default '{}',   -- Theme shape owned by doc 03
  default_closed_message text,
  -- privacy (doc 04 section 7.1)
  store_ip               boolean not null default false,
  retention_days         int check (retention_days is null or retention_days between 30 and 3650), -- null = keep forever
  consent_default_text   text,
  default_country        text not null default 'US' check (default_country ~ '^[A-Z]{2}$'),  -- phone parsing
  privacy_notice_url     text check (privacy_notice_url is null or privacy_notice_url ~ '^https://'),
  show_powered_by        boolean not null default true,  -- plain toggle, nothing gates it
  -- pixels (R7)
  pixel_consent_mode     pixel_consent_mode not null default 'banner',
  pixel_notice_ack_by    uuid references profiles(id) on delete set null,
  pixel_notice_ack_at    timestamptz,
  -- lifecycle (doc 05 sections 1.3, 1.4)
  archived_at            timestamptz,         -- writes frozen, public pages closed
  deleted_at             timestamptz,         -- deletion requested; hidden; restorable for 30 days
  deleted_by             uuid references profiles(id) on delete set null,
  storage_bytes_used     bigint not null default 0,   -- reconciled daily from storage.objects
  storage_reconciled_at  timestamptz,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (pixel_consent_mode <> 'notice' or pixel_notice_ack_at is not null),
  check (deleted_at is null or archived_at is not null)
);

create table workspace_slug_history (           -- doc 05: old slugs redirect for 30 days, then free
  slug         text primary key,
  workspace_id uuid references workspaces(id) on delete set null,   -- null after hard delete: held, no redirect
  released_at  timestamptz not null default now()
);
create index workspace_slug_history_ws on workspace_slug_history (workspace_id);
alter table profiles add foreign key (last_workspace_id) references workspaces(id) on delete set null;

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         workspace_role not null,
  invite_id    uuid,                                   -- which invite brought them in
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create unique index workspace_one_owner on workspace_members (workspace_id) where role = 'owner';
create index workspace_members_user on workspace_members (user_id);

create table workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token        text not null unique default gen_token(24),   -- link: /join/{token}
  role         workspace_role not null check (role <> 'owner'),
  label        text check (label is null or length(label) <= 80),   -- "Fall interns" (doc 05)
  created_by   uuid references profiles(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  max_uses     int not null default 1 check (max_uses between 1 and 50),
  used_count   int not null default 0,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (used_count <= max_uses)
);
create index workspace_invites_ws on workspace_invites (workspace_id);

create table workspace_limits (                 -- R13: per-workspace overrides, platform admin only
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  max_file_bytes         bigint check (max_file_bytes > 0),
  max_files_per_response int    check (max_files_per_response > 0),
  max_questions          int    check (max_questions > 0),
  max_definition_bytes   int    check (max_definition_bytes > 0),
  rate_limit_per_hour    int    check (rate_limit_per_hour > 0),   -- submissions per IP per survey
  raw_script_pixels_allowed boolean,          -- doc 05 kill switch for custom_script and gtm; null = true
  note                   text,                                     -- why the override exists, required by the admin form
  updated_by             uuid references profiles(id) on delete set null,
  updated_at             timestamptz not null default now()
);
```

**Slugs.** `rename_workspace_slug(p_workspace_id, p_slug)` (A) inserts the old slug into `workspace_slug_history` and sets the new one. Because uniqueness spans two tables, both `admin_create_workspace` and the rename refuse a slug that is live in `workspaces` or held in history; a guard trigger refuses direct `slug` updates. The dashboard redirects `/w/{old}` while the history row has a `workspace_id`. pg_cron deletes history rows older than 30 days.

`gen_token(n)` returns `n` random bytes as URL-safe base64 without padding (`translate(encode(gen_random_bytes(n),'base64'),'+/=','-_')`), defined in 0001 and reused for invite tokens, respondent tokens, share tokens, and resume secrets. Exactly one owner is enforced by the partial unique index plus `admin_create_workspace` and `transfer_workspace_ownership` being the only paths that write `role = 'owner'` (a guard trigger on `workspace_members` refuses it otherwise). The same guard enforces doc 05's member rules: admins manage editors and viewers; promoting to admin and demoting or removing an admin is owner only.

**Privacy and pixel settings live on `workspaces`, not a separate `workspace_settings` table.** They are 1:1 with the workspace, written by the same role (admin), logged by the same trigger, and read on every public request together with name and logo. A second table would add a join to `resolve_public_survey` and `submit_response` and a second RLS policy with identical rules. Column-level exposure is not a concern because anon reads no tables (R1). `pixel_notice_ack_*` records the responsibility acknowledgment R7 requires for `notice` mode.

**Global limits** (00 "Global limits") are constants in `effective_limits()`; a `null` column in `workspace_limits` means "use the default". A test asserts the SQL constants equal `src/lib/limits.ts`.

| Column | Default |
|---|---|
| `max_file_bytes` | 26214400 (25 MB) |
| `max_files_per_response` | 20 |
| `max_questions` | 300 |
| `max_definition_bytes` | 1048576 (1 MB) |
| `rate_limit_per_hour` | 20 |
| `raw_script_pixels_allowed` | true |

There is no plan, quota, or usage table of any kind (R10, R12).

### Helpers

```sql
create or replace function is_member(p_workspace_id uuid, p_min_role workspace_role default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from workspace_members m
    join profiles p   on p.id = m.user_id
    join workspaces w on w.id = m.workspace_id
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and p.status = 'active'
      and m.role >= p_min_role
      and w.deleted_at is null
      and (w.archived_at is null or p_min_role = 'viewer')   -- archived: read only (doc 05)
  );
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_platform_admin and status = 'active');
$$;

create or replace function is_active_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

-- profiles policy: can I see this other user?
create or replace function shares_workspace(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members a join workspace_members b using (workspace_id)
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

create or replace function effective_limits(p_workspace_id uuid)
returns table (max_file_bytes bigint, max_files_per_response int, max_questions int,
               max_definition_bytes int, rate_limit_per_hour int, raw_script_pixels_allowed boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(l.max_file_bytes, 26214400),
         coalesce(l.max_files_per_response, 20),
         coalesce(l.max_questions, 300),
         coalesce(l.max_definition_bytes, 1048576),
         coalesce(l.rate_limit_per_hour, 20),
         coalesce(l.raw_script_pixels_allowed, true)
  from (select 1) d
  left join workspace_limits l on l.workspace_id = p_workspace_id
  where auth.role() = 'service_role' or is_member(p_workspace_id) or is_platform_admin();
$$;
grant execute on function effective_limits(uuid) to authenticated, service_role;
```

### Workspace lifecycle (doc 05)

Archive, then at least 7 days archived, then delete requested (`deleted_at`), then a 30 day restore window, then a hard delete run by Vercel Cron because it removes Storage objects. Timing lives in one guard trigger so no path can skip a step:

```sql
create or replace function guard_workspace_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('survey.purge', true) is distinct from 'on'
       or old.deleted_at is null or old.deleted_at > now() - interval '30 days' then
      raise exception 'Workspace % can only be purged 30 days after deletion was requested', old.id;
    end if;
    return old;
  end if;
  if new.deleted_at is distinct from old.deleted_at
     and current_setting('survey.lifecycle', true) is distinct from 'on' then
    raise exception 'Use request_workspace_deletion() or restore_workspace()';
  end if;
  if new.deleted_at is not null and old.deleted_at is null
     and (old.archived_at is null or old.archived_at > now() - interval '7 days') then
    raise exception 'A workspace must be archived for 7 days before deletion';
  end if;
  if new.deleted_at is null and old.deleted_at is not null
     and old.deleted_at <= now() - interval '30 days' then
    raise exception 'The 30 day restore window has passed';
  end if;
  if new.archived_at is null and old.archived_at is not null and new.deleted_at is not null then
    raise exception 'Restore the workspace before unarchiving it';
  end if;
  if new.archived_at is distinct from old.archived_at
     and current_setting('survey.lifecycle', true) is distinct from 'on' then
    raise exception 'Use archive_workspace() or unarchive_workspace()';
  end if;
  if new.slug is distinct from old.slug
     and current_setting('survey.lifecycle', true) is distinct from 'on' then
    raise exception 'Use rename_workspace_slug()';
  end if;
  return new;
end $$;
create trigger workspaces_lifecycle before update or delete on workspaces
  for each row execute function guard_workspace_lifecycle();
```

| Function | Who | Effect |
|---|---|---|
| `archive_workspace(p_ws)` / `unarchive_workspace(p_ws)` | owner or PA | sets or clears `archived_at` (role checked against `workspace_members` directly, since `is_member` is read only while archived) |
| `request_workspace_deletion(p_ws, p_confirm_slug)` | owner or PA | `p_confirm_slug` must equal the slug; sets `deleted_at`, `deleted_by` |
| `restore_workspace(p_ws)` | PA | clears `deleted_at` inside the window; stays archived |
| `workspace_purge_due(p_limit int)` | service role | ids with `deleted_at <= now() - interval '30 days'` |
| `purge_workspace(p_ws)` | service role | writes the `platform_audit_log` row with name, slug, owner, deleted by, and counts (surveys, responses, contacts, bytes); moves the slug to `workspace_slug_history` with `workspace_id` null; retires every alias (held 30 days, section 3); enqueues every Storage object under `{workspace_id}/` in each bucket into `storage_deletions`; raises `survey.purge` and deletes the row, cascading everything else |

Every function writes `activity_log` (while the workspace exists) and, when the caller is a platform admin, `platform_audit_log`. Archived and deleted workspaces close their public surveys (section 11); deleted ones resolve to nothing.

### Platform admin tables (doc 05)

```sql
create table workspace_requests (        -- a member asks platform admins for a new workspace
  id              uuid primary key default gen_random_uuid(),
  requested_by    uuid not null references profiles(id) on delete cascade,
  department_name text not null check (length(btrim(department_name)) between 1 and 80),
  purpose         text check (purpose is null or length(purpose) <= 2000),
  status          text not null default 'open' check (status in ('open','approved','dismissed')),
  workspace_id    uuid references workspaces(id) on delete set null,   -- set on approval
  reviewed_by     uuid references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table access_requests (           -- an uninvited (pending) sign-in asks for access
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  department  text,
  reason      text check (reason is null or length(reason) <= 2000),
  status      text not null default 'open' check (status in ('open','approved','dismissed')),
  invite_id   uuid references platform_invites(id) on delete set null,   -- invite minted on approval
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index access_requests_one_open on access_requests (user_id) where status = 'open';

create table platform_audit_log (        -- platform admin actions; not workspace scoped, survives purge
  id          bigint generated always as identity primary key,
  actor       uuid references profiles(id) on delete set null,   -- null = cron / service role
  action      text not null,   -- 'invite.create', 'workspace.create', 'workspace.purge', 'ownership.force_transfer',
                               -- 'limits.update', 'user.disable', 'password_reset.mint', 'survey.admin_close', ...
  target_type text not null,   -- 'workspace', 'user', 'invite', 'survey', 'abuse_report', 'settings'
  target_id   uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index platform_audit_time on platform_audit_log (created_at desc);
create index platform_audit_target on platform_audit_log (target_type, target_id);

create table abuse_reports (             -- public form at /report?s={slug} (docs 02, 05)
  id               uuid primary key default gen_random_uuid(),
  survey_id        uuid references surveys(id) on delete set null,       -- null when the slug is unknown
  workspace_id     uuid references workspaces(id) on delete set null,
  slug_text        text not null check (length(slug_text) <= 100),     -- what the reporter submitted, stored as is
  reason           text not null check (reason in ('phishing','sensitive_data','harassment','other')),
  details          text check (details is null or length(details) <= 2000),
  reporter_contact text check (reporter_contact is null or length(reporter_contact) <= 200),
  ip_hash          text,          -- daily-salted HMAC, same as rate limiting; never the raw IP
  status           text not null default 'open' check (status in ('open','dismissed','actioned')),
  reviewed_by      uuid references profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index abuse_reports_open on abuse_reports (created_at desc) where status = 'open';
```

`abuse_reports` is written only by the `/report` route handler with the service role (after Turnstile and the 5 per IP per hour limit); unknown slugs are stored, not rejected, so the form never confirms whether a survey exists. Approving an access request mints a `platform_invites` row and activates that user immediately through `admin_approve_access_request(p_id)`.

## 3. Surveys, versions, aliases, templates

```sql
create table surveys (
  id                           uuid primary key default gen_random_uuid(),
  workspace_id                 uuid not null references workspaces(id) on delete cascade, -- immutable (guard)
  title                        text not null default 'Untitled survey',   -- internal name
  slug                         text not null unique default gen_survey_slug()
                               check (slug ~ '^[a-z0-9]{10}$'),
  -- state (doc 02 section 3)
  state                        survey_state not null default 'draft',
  opens_at                     timestamptz,
  closes_at                    timestamptz,
  closed_message               text check (closed_message is null or length(closed_message) <= 1000),
  response_cap                 int check (response_cap is null or response_cap > 0),  -- null = unlimited
  complete_count               int not null default 0,      -- maintained by submit_response only
  -- identity (section 5, R6)
  identity_question_key        text,                       -- email question used as identity key
  identity_phone_key           text,                       -- optional phone identity
  trust_hidden_identity        boolean not null default false, -- ?email= / ?contact= may create or link
  -- delivery (doc 02)
  excluded_pixel_ids           uuid[] not null default '{}',   -- per-survey pixel opt-outs
  og_title                     text check (og_title is null or length(og_title) <= 120),
  og_description               text check (og_description is null or length(og_description) <= 300),
  og_image_path                text,                       -- public-assets/{workspace_id}/og/{survey_id}.{ext}
  allow_indexing               boolean not null default false, -- robots noindex unless true
  settings                     jsonb not null default '{}',  -- builder-only settings (doc 03)
  -- version pointers
  current_draft_version_id     uuid,                       -- fk added after survey_versions
  latest_published_version_id  uuid,
  archived_at                  timestamptz,
  admin_closed_reason          text,                       -- set by admin_close_survey (doc 05), shown as a banner
  admin_closed_at              timestamptz,
  created_by                   uuid references profiles(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (state <> 'scheduled' or opens_at is not null),
  check (opens_at is null or closes_at is null or opens_at < closes_at)
);
create index surveys_ws on surveys (workspace_id, updated_at desc);
-- guard_survey(): workspace_id, slug, complete_count, and the version pointers are not
-- client writable (functions raise survey.internal to change them).

create table survey_versions (
  id                      uuid primary key default gen_random_uuid(),
  survey_id               uuid not null references surveys(id) on delete cascade,
  workspace_id            uuid not null references workspaces(id) on delete cascade, -- denormalized for RLS
  version_no              int not null,
  status                  version_status not null default 'draft',
  revision                int not null default 0,      -- R8: bumped on every draft save and lock takeover
  definition              jsonb not null default '{"pages":[]}',  -- full, server only once published
  public_definition       jsonb,                       -- R9: browser-safe half, written at publish
  definition_hash         text,                        -- sha256 of definition, set at publish
  created_from_version_id uuid references survey_versions(id) on delete set null,
  locked_by               uuid references profiles(id) on delete set null,
  locked_at               timestamptz,
  published_at            timestamptz,
  published_by            uuid references profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (survey_id, version_no),
  check ((status = 'published') = (published_at is not null)),
  check ((status = 'published') = (public_definition is not null))
);
create unique index survey_one_draft on survey_versions (survey_id) where status = 'draft';
alter table surveys add foreign key (current_draft_version_id)    references survey_versions(id) on delete set null;
alter table surveys add foreign key (latest_published_version_id) references survey_versions(id) on delete set null;

create table questions (            -- normalized snapshot, written only by publish_survey_version
  id                uuid primary key default gen_random_uuid(),
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  question_key      text not null check (question_key ~ '^q_[a-z0-9]{8}$'),
  page_index        int not null,
  position          int not null,           -- global order within the version
  type              text not null,          -- vocabulary owned by doc 03
  label             text not null,
  label_hash        text not null,          -- detects wording changes across versions
  required          boolean not null default false,
  is_pii            boolean not null default false,  -- builder flag; anonymize deletes these answers
  options           jsonb,                  -- [{id, label}], option ids are stable like question keys (R5)
  config            jsonb not null default '{}',     -- includes contact_field mapping (doc 03)
  unique (survey_version_id, question_key)
);
create index questions_key on questions (survey_id, question_key);

create table survey_aliases (       -- doc 02, simplified by R2: one scope, globally unique
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid references surveys(id) on delete set null,     -- null after survey delete: held, resolves to nothing
  workspace_id uuid references workspaces(id) on delete set null,
  alias        text not null check (
                 alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                 and length(alias) between 3 and 60
                 and alias !~ '^[a-z0-9]{10}$'                -- cannot look like a slug
                 and alias not in ('api','s','w','r','f','e','admin','login','logout','app','www',
                                   'static','well-known','invite','join','privacy','auth','pending')
               ),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz                                   -- set on rename; held 30 days
);
create unique index survey_aliases_alias      on survey_aliases (alias);  -- global, retired rows included
create unique index survey_aliases_one_active on survey_aliases (survey_id) where retired_at is null;

create table survey_templates (     -- R8, doc 03
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,   -- null = system template
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text,
  definition   jsonb not null,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index survey_templates_ws on survey_templates (workspace_id);
```

`gen_survey_slug()` draws 10 characters from `[a-z0-9]` using `gen_random_bytes`. Collisions are retried by the unique constraint in `create_survey`.

**Aliases.** A survey has at most one active alias. `set_survey_alias(p_survey_id, p_alias)` (editor) retires the current row (`retired_at = now()`) and inserts the new one; if the new alias is the survey's own retired alias it is un-retired instead. Because the unique index covers retired rows, nobody else can take a retired alias until pg_cron prunes rows with `retired_at < now() - interval '30 days'`. Retired aliases keep resolving during the hold. A `before delete` trigger on `surveys` retires the survey's active alias, and the foreign keys are `on delete set null`, so a deleted survey's or purged workspace's alias is held 30 days (resolving to nothing) rather than freed for someone else at once. Aliases are stored lowercase; `/s/{key}` lowercases before lookup.

## 4. Versioning mechanics

**Draft vs published.** A survey always has exactly one draft version (`survey_one_draft`) and zero or more published versions. Published versions are frozen forever. `surveys.latest_published_version_id` is what the public page serves to new respondents; a partial keeps answering against its own version.

**Revision and autosave (R8).** The builder never updates `survey_versions` directly. Autosave calls:

```sql
save_draft(p_version_id uuid, p_expected_revision int, p_definition jsonb) returns int  -- new revision
```

It requires `E`, an unexpired lock held by the caller, `status = 'draft'`, the definition size and question count within `effective_limits`, then runs `update survey_versions set definition = p_definition, revision = revision + 1, locked_at = now() where id = p_version_id and revision = p_expected_revision`. Zero rows raises `revision_conflict`, which the editor treats as "someone took over" and goes read-only.

**Lock.** `locked_by` and `locked_at` live on the draft row.

- `take_draft_lock(p_version_id uuid, p_force boolean default false) returns jsonb` succeeds if the lock is empty, held by the caller (heartbeat refresh), older than 15 minutes, or `p_force` is true. A forced takeover from another live holder increments `revision` and logs `lock_takeover`, so the previous holder fails on both the lock check and the revision check. Returns `{ok, locked_by, locked_at, revision}`.
- `release_draft_lock(p_version_id uuid) returns void` clears the lock if the caller holds it, otherwise does nothing. Called best effort by `sendBeacon` on tab close.

**Immutability.** One trigger enforces it:

```sql
create or replace function guard_survey_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' and current_setting('survey.purge', true) is distinct from 'on' then
      raise exception 'Published versions cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    raise exception 'Published version % is immutable', old.id;
  end if;
  if new.status = 'published' and current_setting('survey.publishing', true) is distinct from 'on' then
    raise exception 'Use publish_survey_version() to publish';
  end if;
  return new;
end $$;
create trigger survey_versions_guard before update or delete on survey_versions
  for each row execute function guard_survey_version();
```

There is no client update policy on `survey_versions`; drafts change only through `save_draft`, the lock functions, and publish. `questions` has a matching trigger that refuses insert, update, and delete unless `survey.publishing` (insert) or `survey.purge` (delete) is on. `survey.purge` is raised only by `delete_survey` and `purge_workspace`.

**Public definition split (R9).** Doc 03 owns the server-only field list (quiz correct answers, per-option scores, scoring thresholds) and the pure `splitDefinition(definition)` helper in TypeScript. SQL cannot run it, so the publish route handler calls `splitDefinition` on the draft it just loaded and passes the result to `publish_survey_version` together with the revision it loaded. The function re-checks the revision (so the split matches the frozen definition) and refuses a `p_public_definition` that contains any server-only key, using a SQL constant list that a test keeps equal to doc 03's list. `definition` of a published version is read only by members and by the service role; anon reads `public_definition` through `get_public_definition`.

**question_key stability rules.**

1. The builder generates the key when a question is created: `q_` plus 8 random `[a-z0-9]`. It never changes afterward, even when the label, help text, or options change.
2. Duplicating a question creates a new key. Deleting and re-adding creates a new key.
3. A key may never come back with a different type family. `publish_survey_version` checks every key against all earlier `questions` rows of the same survey and fails if the storage column differs. Doc 03 defines compatible type groups.
4. Choice option ids follow the same rules (R5). Answers store option ids, never labels, so renaming an option does not break cross-version reports.
5. A label change is allowed and is visible to reports via `label_hash`, so a cross-version report can flag "wording changed in v4".

**Cloning a new draft.** At publish, the function inserts a new `survey_versions` row with `version_no = published.version_no + 1`, `revision = 0`, `definition` copied verbatim, `created_from_version_id = published.id`, and the lock carried over to the publisher so they can keep editing.

## 5. Respondent identity and contacts

```sql
create table contacts (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  email                  text check (email is null or email = lower(btrim(email))),
  phone                  text,          -- E.164, parsed with workspaces.default_country
  first_name             text,
  last_name              text,
  company                text,
  lead_status            lead_status not null default 'new',
  lead_status_changed_at timestamptz,                  -- doc 04
  owner_id               uuid references profiles(id) on delete set null,   -- doc 04, a member
  follow_up_at           date,                         -- doc 04
  follow_up_note         text,                         -- doc 04
  tags                   text[] not null default '{}',
  custom                 jsonb not null default '{}',  -- validated against contact_field_defs
  source                 text,          -- 'survey:<survey_id>', 'token', 'manual', 'import'
  status                 text not null default 'active' check (status in ('active', 'deleted')), -- doc 04 tombstone
  merged_into            uuid references contacts(id) on delete set null,
  merged_at              timestamptz,
  deleted_at             timestamptz,
  last_response_at       timestamptz,   -- maintained by submit_response
  response_count         int not null default 0,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'deleted') = (deleted_at is not null))
);
create unique index contacts_ws_email_live on contacts (workspace_id, email)
  where email is not null and merged_into is null and status = 'active';
create index contacts_ws_phone   on contacts (workspace_id, phone) where phone is not null;  -- not unique: households
create index contacts_ws_recent  on contacts (workspace_id, last_response_at desc nulls last);
create index contacts_ws_updated on contacts (workspace_id, updated_at desc, id);  -- list keyset
create index contacts_tags       on contacts using gin (tags);
create index contacts_custom     on contacts using gin (custom jsonb_path_ops);
create index contacts_email_trgm on contacts using gin (email gin_trgm_ops);       -- duplicates

create table contact_aliases (       -- written only by merge_contacts
  alias_id     uuid primary key,     -- the merged-away contact id
  contact_id   uuid not null references contacts(id) on delete cascade,  -- survivor
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text,                 -- loser's email at merge time
  phone        text,
  merged_by    uuid references profiles(id) on delete set null,
  merged_at    timestamptz not null default now()
);
create index contact_aliases_contact on contact_aliases (contact_id);
create index contact_aliases_email on contact_aliases (workspace_id, email);

create table contact_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  author       uuid references profiles(id) on delete set null,
  body         text not null check (length(body) between 1 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index contact_notes_contact on contact_notes (contact_id, created_at desc);

create table respondent_tokens (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  survey_id     uuid not null references surveys(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  token         text not null unique default gen_token(16),   -- 22 char base64url, appears in ?t=
  max_responses int not null default 1 check (max_responses >= 1),
  used_count    int not null default 0,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (survey_id, contact_id)
);

create table contact_field_defs (    -- doc 04
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),   -- never changes
  label        text not null,
  type         text not null check (type in ('text','number','date','select','multiselect','boolean','url')),
  options      jsonb,                -- for select and multiselect
  position     int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

create table contact_views (         -- doc 04 saved views
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  filters      jsonb not null default '{}',   -- ContactViewFilters (doc 04)
  columns      text[] not null default '{}',
  sort         jsonb not null default '{}',
  shared       boolean not null default false,
  builtin      boolean not null default false,
  created_by   uuid references profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index contact_views_ws on contact_views (workspace_id);

create table contact_duplicate_dismissals (   -- doc 04 "Not a duplicate"
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_a    uuid not null references contacts(id) on delete cascade,
  contact_b    uuid not null references contacts(id) on delete cascade,
  dismissed_by uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, contact_a, contact_b),
  check (contact_a < contact_b)
);

create table contact_imports (       -- doc 04 CSV import
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  storage_path    text,              -- imports/{workspace_id}/{id}.csv, nulled after 30 days
  mapping         jsonb not null default '{}',
  options         jsonb not null default '{}',
  status          text not null default 'pending'
                  check (status in ('pending','running','done','failed')),
  created         int not null default 0,
  updated         int not null default 0,
  skipped         int not null default 0,
  invalid         int not null default 0,
  token_survey_id uuid references surveys(id) on delete set null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
```

**Contact resolution** (rules owned by doc 04, run inside `submit_response` on `complete` only; partials never create contacts):

1. Valid `?t=` token for this survey, following `merged_into` to the survivor. `identity_source = 'token'`. Never creates.
2. Identity question value: email normalized and matched against live contacts, then `contact_aliases.email`, else created. Phone is used only when it is the identity key, no email was given, and exactly one live contact has it; zero creates, two or more leave the response unlinked. `identity_source = 'identity_answer'`.
3. Only when `surveys.trust_hidden_identity` is true (R6): `?contact=` (resolved through `contact_aliases`), then `?email=`, match or create. `identity_source = 'hidden_field'`, shown with an "unverified" badge.
4. Otherwise the response is anonymous.

A token plus a different identity email keeps the token's contact and records the other email in `responses.metadata.alt_email`. Question-to-contact mapping (`questions.config.contact_field`) fills blank fields only. Tombstoned and merged contacts are skipped. When a member leaves a workspace, a trigger on `workspace_members` delete nulls `contacts.owner_id` for their contacts in that workspace. Every `lead_status` change sets `lead_status_changed_at` (trigger) and is logged.

## 6. Responses, files, submission support

```sql
create table responses (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  survey_id           uuid not null references surveys(id) on delete cascade,
  survey_version_id   uuid not null references survey_versions(id),
  status              response_status not null default 'partial',
  contact_id          uuid references contacts(id) on delete set null,
  respondent_token_id uuid references respondent_tokens(id) on delete set null,
  identity_source     text check (identity_source in ('token','identity_answer','hidden_field')),
  respondent_hash     text,                 -- the per-tab rid from doc 04
  resume_token_hash   text unique,          -- sha256 hex of the resume secret; nulled on complete or after 30 days
  last_question_key   text,
  score               numeric,              -- computed in submit_response (R9)
  score_max           numeric,
  started_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  metadata            jsonb not null default '{}',
  ip                  inet,                 -- only when workspaces.store_ip
  raw                 jsonb not null default '{}',
  anonymized_at       timestamptz,
  updated_at          timestamptz not null default now(),
  check ((status = 'complete') = (submitted_at is not null))
);
create index responses_survey_inbox on responses (survey_id, submitted_at desc) where status = 'complete';
create index responses_version on responses (survey_version_id);
create index responses_contact on responses (contact_id) where contact_id is not null;
create index responses_ws_age on responses (workspace_id, coalesce(submitted_at, started_at));  -- retention
create index responses_rid on responses (survey_id, respondent_hash) where respondent_hash is not null;

create table answers (
  id                bigint generated always as identity primary key,
  response_id       uuid not null references responses(id) on delete cascade,
  workspace_id      uuid not null,
  survey_id         uuid not null,
  survey_version_id uuid not null,
  question_key      text not null,
  value_text        text,
  value_number      numeric,
  value_date        date,
  value_json        jsonb,   -- multi-choice option ids, matrix, ranking, file ids
  unique (response_id, question_key)
);
create index answers_report on answers (survey_id, question_key);

create table response_files (       -- doc 02 "pending_uploads"; one table for pending and attached
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  survey_id     uuid not null references surveys(id) on delete cascade,
  question_key  text not null,
  response_id   uuid references responses(id) on delete cascade,  -- null until attached
  status        text not null default 'pending' check (status in ('pending','attached')),
  object_path   text not null unique,  -- {workspace_id}/{survey_id}/pending/{id}/{safe_name}, moved after attach
  declared_size bigint not null,
  declared_mime text not null,
  original_name text not null,
  size_bytes    bigint,                -- verified from storage.objects at attach
  mime_type     text,
  created_at    timestamptz not null default now(),
  attached_at   timestamptz,
  moved_at      timestamptz,
  check ((status = 'attached') = (response_id is not null))
);
create index response_files_pending on response_files (created_at) where status = 'pending';
create index response_files_response on response_files (response_id) where response_id is not null;

create table storage_deletions (    -- doc 02; outbox for Storage API deletes
  id           bigint generated always as identity primary key,
  bucket       text not null,
  path         text not null,
  workspace_id uuid,                 -- no fk: must outlive workspace deletion
  reason       text not null check (reason in ('retention','orphan','erase','survey_delete',
                                     'workspace_delete','export_expired','import_expired','replaced')),
  enqueued_at  timestamptz not null default now(),
  attempts     int not null default 0,
  last_error   text,
  done_at      timestamptz
);
create index storage_deletions_todo on storage_deletions (enqueued_at) where done_at is null;

create table submission_idempotency (   -- doc 02
  key         uuid primary key,          -- client idempotencyKey, one per save/complete attempt
  survey_id   uuid not null references surveys(id) on delete cascade,
  response_id uuid references responses(id) on delete cascade,
  result      jsonb,                     -- stored SubmitResult, returned verbatim on retry
  created_at  timestamptz not null default now()
);
create index submission_idempotency_age on submission_idempotency (created_at);

create unlogged table rate_limit_events (   -- doc 02, sliding window log
  bucket text not null,
  key    text not null,
  at     timestamptz not null default now()
);
create index rate_limit_events_lookup on rate_limit_events (bucket, key, at desc);
```

`answers` repeats `workspace_id`, `survey_id`, `survey_version_id` so reports and RLS never join through `responses`. Values are written only by SQL functions, so the denormalized columns cannot drift.

**`responses.metadata` keys** (standardized here for docs 02, 03, 04): `hidden` (object of sanitized URL params), `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `device` (`mobile | tablet | desktop`), `user_agent`, `referrer_host`, `locale`, `alt_email`, `random_seed`. The raw IP never goes in `metadata`; it is the typed `ip` column, written only when `workspaces.store_ip`. `identity_source` and the rid are columns, not metadata keys, so filters stay indexable.

**Storage buckets.**

| Bucket | Public | Layout | Writes |
|---|---|---|---|
| `response-files` | no | `{workspace_id}/{survey_id}/pending/{file_id}/{name}`, then `{workspace_id}/{survey_id}/{response_id}/{file_id}-{name}` | Signed upload URLs minted by the route handler; moves by service role |
| `public-assets` | yes | `{workspace_id}/logo.{ext}`, `{workspace_id}/og/...`, `{workspace_id}/theme/...` | `is_member(folder[1], 'editor')`; logo by admin through workspace settings |
| `exports` | no | `{workspace_id}/{export_job_id}.{ext}` | Service role |
| `imports` | no | `{workspace_id}/{contact_import_id}.csv` | Editor upload, service role read |

Private bucket reads: `storage.objects` select for authenticated when `is_member(((storage.foldername(name))[1])::uuid, 'viewer')`; downloads use short-lived signed URLs with the `download` option. SVG and HTML are never allowed in `response-files`.

**Deleting files.** SQL never deletes from `storage.objects` (that orphans the file). An `after delete` trigger on `response_files` inserts the row's path into `storage_deletions`, so every path that removes file rows (retention, erase, survey delete, workspace purge, orphan sweep) enqueues automatically, including `on delete cascade`. `purge_workspace` additionally enqueues every object under `{workspace_id}/` in each bucket by reading `storage.objects`. The Vercel Cron sweep (section 13) performs the Storage API deletes and marks rows done.

## 7. Analytics events

```sql
create table events (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  response_id       uuid references responses(id) on delete set null,
  respondent_hash   text,
  type              text not null check (type in ('view','start','question_view','question_answer',
                                     'page_next','page_back','complete','abandon','file_upload')),
  question_key      text,
  occurred_at       timestamptz not null default now(),
  meta              jsonb not null default '{}'
);
create index events_survey_time  on events (survey_id, occurred_at);
create index events_version_time on events (survey_version_id, occurred_at);
create index events_version_type on events (survey_version_id, type);
create index events_rid          on events (survey_id, respondent_hash);
create index events_response     on events (response_id) where response_id is not null;
create index events_time_brin    on events using brin (occurred_at);

create table event_daily (           -- doc 04 rollup of events older than 180 days
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  day               date not null,
  type              text not null,
  question_key      text not null default '',     -- '' for survey-level events
  count             int not null,
  distinct_rids     int not null,
  primary key (survey_version_id, day, type, question_key)
);

create table stopwords (             -- doc 04 word frequency, seeded in the migration
  lang text not null,
  word text not null,
  primary key (lang, word)
);
```

Vocabulary: `view`, `start`, `question_view`, `question_answer`, `page_next`, `page_back`, `complete` (emitted only by `submit_response`), `abandon`, `file_upload`. The beacon route `/api/e` calls `record_events(p_events jsonb)` with the service role (max 50 per call, `complete` refused there). `respondent_hash` is doc 04's per-tab random rid; never derived from IP or device traits. Events never carry answer values.

## 8. Reports and exports

```sql
create table reports (               -- doc 04
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  survey_id    uuid not null references surveys(id) on delete cascade,
  name         text not null,
  is_default   boolean not null default false,   -- materialized default report
  filters      jsonb not null default '{}',
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index reports_one_default on reports (survey_id) where is_default;

create table report_widgets (        -- doc 04
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references reports(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,  -- denormalized for RLS
  position      int not null,
  question_key  text,
  metric        text,                -- funnel metric when question_key is null
  chart_type    text not null check (chart_type in ('bar','stacked_bar','pie','table','histogram',
                                     'nps_gauge','heat_table','word_list','line','stat')),
  cross_tab_key text,
  options       jsonb not null default '{}',
  check ((question_key is null) <> (metric is null))
);
create index report_widgets_report on report_widgets (report_id, position);

create table report_shares (         -- doc 04 public share links, read only via shared_report_payload
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references reports(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  token          text not null unique default gen_token(16),   -- /r/{token}
  expires_at     timestamptz default now() + interval '30 days',  -- null = no expiry
  password_hash  text,                 -- crypt() bcrypt
  revoked_at     timestamptz,
  created_by     uuid references profiles(id) on delete set null,
  view_count     int not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);

create table export_jobs (           -- doc 04 large exports
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  survey_id    uuid references surveys(id) on delete cascade,
  kind         text not null check (kind in ('responses','contacts')),
  format       text not null check (format in ('csv','xlsx')),
  filters      jsonb not null default '{}',
  status       text not null default 'pending' check (status in ('pending','running','done','failed')),
  cursor       jsonb,                -- resume point when a run hits maxDuration
  storage_path text,                 -- exports/{workspace_id}/{id}.{format}, nulled after 7 days
  row_count    int,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index export_jobs_ws on export_jobs (workspace_id, created_at desc);
```

`report_shares` has no anon policy and no anon grant. `/r/{token}` calls `shared_report_payload(p_token, p_password)` with the service role; that function derives report, survey, and workspace from the share row and returns aggregates only (doc 04 section 5.4).

## 9. Workspace pixels

```sql
create table workspace_pixels (      -- doc 02
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type         pixel_type not null,
  value        text not null check (
                 (type = 'ga4'  and value ~ '^G-[A-Z0-9]{4,12}$') or
                 (type = 'meta' and value ~ '^[0-9]{8,20}$') or
                 (type = 'gtm'  and value ~ '^GTM-[A-Z0-9]{4,10}$') or
                 (type = 'custom_script' and length(value) <= 10000)),
  parsed       jsonb,                -- custom_script parsed into <script>/<noscript> parts at save
  label        text not null,
  enabled      boolean not null default true,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index workspace_pixels_ws on workspace_pixels (workspace_id);
```

Per-survey opt-out is `surveys.excluded_pixel_ids`; a stale id after a pixel is deleted is harmless. When `effective_limits(workspace_id).raw_script_pixels_allowed` is false (doc 05 kill switch), a `before insert or update` trigger refuses enabling `custom_script` and `gtm` rows, and `resolve_public_survey` omits existing ones, so flipping the switch takes effect on the next page load without editing pixel rows. Per R15 public pages run on their own hostname, so these scripts never share an origin with dashboard session cookies. Public pages receive pixels inside `resolve_public_survey`, not through a third anon function. Consent behavior follows `workspaces.pixel_consent_mode` (R7).

## 10. Audit

```sql
create table activity_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor        uuid references profiles(id) on delete set null,   -- null = system/service role
  entity       text not null,     -- 'survey', 'survey_version', 'alias', 'template', 'contact', 'member',
                                  -- 'invite', 'workspace', 'pixel', 'limits', 'report', 'share', 'export', 'import'
  entity_id    uuid,
  action       text not null,     -- 'create', 'update', 'delete', 'publish', 'lock_takeover', 'merge', 'erase', ...
  diff         jsonb not null default '{}',   -- {"field": [old, new]}, changed fields only
  created_at   timestamptz not null default now()
);
create index activity_ws_time on activity_log (workspace_id, created_at desc);
create index activity_entity on activity_log (entity, entity_id);
```

Written by a generic `log_activity()` `after insert or update or delete` trigger on `surveys`, `survey_aliases`, `survey_templates` (workspace rows), `contacts`, `contact_notes`, `contact_field_defs`, `workspace_members`, `workspace_invites`, `workspaces`, `workspace_pixels`, `workspace_limits`, `reports`, `report_shares`, plus explicit inserts from functions (`publish`, `merge`, `erase`, `lock_takeover`, exports, imports). Doc 03's coalesced `survey.draft_edited` rows are inserted by `save_draft` at most once per editor per 10 minute window. Doc 04's timeline queries `entity = 'contact' and entity_id = $1`. Append only: no update or delete policy for anyone; `erase_respondent` rewrites diffs for the erased contact to `{"redacted": true}` and pg_cron prunes old rows.

## 11. RLS policies

`V` = `is_member(workspace_id,'viewer')`, `E` = editor, `A` = admin, `O` = owner, `PA` = `is_platform_admin()`. "fn" means only through a SQL function. "none" means no policy (denied for anon and authenticated; service role bypasses). Anon appears nowhere in this table.

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| profiles | self, `shares_workspace(id)`, PA | trigger only | self (guarded); PA status | none |
| platform_invites | PA | PA | PA (revoke) | PA |
| platform_settings | active profile | none (seeded) | PA | none |
| workspaces | V, PA | fn `admin_create_workspace` (PA) | A (guarded: lifecycle and slug via fn) | fn `purge_workspace` (service role, after 30 days) |
| workspace_slug_history | V | fn | none | cron |
| workspace_requests | own (`requested_by = auth.uid()`), PA | active profile, own | PA | none |
| access_requests | own (`user_id = auth.uid()`), PA | own (pending allowed) | PA | none |
| platform_audit_log | PA | fn | none | none |
| abuse_reports | PA | none (service role route) | PA (review) | none |
| workspace_members | V | fn (create, claim) | guarded: A for editor/viewer rows, O for admin rows, never to owner | A (editor/viewer), O (admin), self leaving (non-owner) |
| workspace_invites | A | A | A (revoke) | A |
| workspace_limits | V, PA | fn `admin_set_workspace_limits` (PA) | same fn | same fn |
| workspace_pixels | V | A | A | A |
| surveys | V | fn `create_survey` (E) | E (guarded columns) | fn `delete_survey` (A) |
| survey_versions | V | fn (create, publish) | fn (`save_draft`, lock fns) | none (cascade via fn) |
| questions | V | fn publish | none | none |
| survey_aliases | V | fn `set_survey_alias` (E) | fn | none (cascade, cron prune) |
| survey_templates | `workspace_id is null` and active profile, or V | null ws: PA; else E | same as insert | same as insert |
| responses | V | fn (service role) | fn (flags, E) | A |
| answers | V | fn | none | cascade |
| response_files | V | fn (service role) | fn | cascade |
| storage_deletions | none | trigger/fn | fn | cron |
| submission_idempotency | none | fn | fn | cron |
| rate_limit_events | none | fn | none | cron |
| respondent_tokens | E | E | E (revoke, max) | E |
| contacts | V | E | E (tombstones refused) | fn `erase_respondent` (A) |
| contact_aliases | V | fn merge | none | fn erase |
| contact_notes | V | E, `author = auth.uid()` | author | author or A |
| contact_field_defs | V | E | E | none (archive instead) |
| contact_views | V and (`shared` or `created_by = auth.uid()`) | V own personal; E shared | creator; E for shared | creator; E for shared; builtin never |
| contact_duplicate_dismissals | V | E | none | E |
| contact_imports | E | E | fn | none |
| events | V | fn (service role) | none | fn, cascade |
| event_daily | V | cron | cron | cascade |
| stopwords | authenticated | none | none | none |
| reports | V | E | E | E |
| report_widgets | V | E | E | E |
| report_shares | E | E | E (revoke) | E |
| export_jobs | `created_by = auth.uid()` or A | E own (row-level exports are editor and above, doc 05) | fn | none (cron nulls file) |
| activity_log | A | trigger/fn | none | none |

### Anon: two functions, zero tables (R1)

```sql
create or replace function survey_effective_state(s surveys, p_workspace_archived boolean default false)
returns table (state text, reason text)
language sql stable set search_path = public as $$
  select
    case
      when s.archived_at is not null or s.state = 'draft'
           or s.latest_published_version_id is null                     then 'draft'
      when p_workspace_archived or s.admin_closed_at is not null        then 'closed'
      when s.state = 'closed'                                           then 'closed'
      when s.opens_at  is not null and now() <  s.opens_at              then 'scheduled'
      when s.closes_at is not null and now() >= s.closes_at             then 'closed'
      when s.response_cap is not null
           and s.complete_count >= s.response_cap                       then 'closed'
      else 'open' end,
    case
      when p_workspace_archived                                         then 'workspace_archived'
      when s.admin_closed_at is not null                                then 'admin'
      when s.state = 'closed'                                           then 'manual'
      when s.closes_at is not null and now() >= s.closes_at             then 'schedule'
      when s.response_cap is not null
           and s.complete_count >= s.response_cap                       then 'cap'
    end;
$$;

create or replace function resolve_public_survey(p_key text)
returns table (
  survey_id          uuid,
  slug               text,
  alias              text,                -- active alias, for the QR and share panel
  matched_by         text,                -- 'slug' | 'alias' | 'retired_alias'
  effective_state    text,                -- 'scheduled' | 'open' | 'closed'
  state_reason       text,                -- 'manual' | 'schedule' | 'cap' | 'admin' | 'workspace_archived' | null
  opens_at           timestamptz,
  closes_at          timestamptz,
  closed_message     text,                -- survey, else workspace default, else null (doc 02 defaults)
  version_id         uuid,                -- latest published, only when effective_state = 'open'
  version_no         int,
  title              text,                -- public title from the published definition
  og_title           text,
  og_description     text,
  og_image_path      text,
  allow_indexing     boolean,
  workspace_name     text,
  logo_path          text,
  show_powered_by    boolean,
  privacy_notice_url text,                -- workspace notice; the org notice is always /privacy
  pixel_consent_mode pixel_consent_mode,
  pixels             jsonb                -- [{id,type,value,parsed}], enabled minus excluded; [] unless open
)
language sql stable security definer set search_path = public as $$
  with k as (select lower(btrim(p_key)) as key),
  hit as (
    select s.id, 'slug'::text as matched_by from surveys s, k where s.slug = k.key
    union all
    select a.survey_id, case when a.retired_at is null then 'alias' else 'retired_alias' end
    from survey_aliases a, k
    where a.alias = k.key
      and (a.retired_at is null or a.retired_at > now() - interval '30 days')
    limit 1
  )
  select s.id, s.slug, cur.alias, h.matched_by,
         e.state, e.reason, s.opens_at, s.closes_at,
         coalesce(s.closed_message, w.default_closed_message),
         case when e.state = 'open' then v.id end,
         case when e.state = 'open' then v.version_no end,
         coalesce(v.public_definition->>'title', s.title),
         s.og_title, s.og_description, s.og_image_path, s.allow_indexing,
         w.name, w.logo_path, w.show_powered_by, w.privacy_notice_url, w.pixel_consent_mode,
         case when e.state = 'open' then coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type,
                                               'value', p.value, 'parsed', p.parsed)
                            order by p.created_at)
           from workspace_pixels p
           where p.workspace_id = s.workspace_id and p.enabled
             and not (p.id = any (s.excluded_pixel_ids))
             and (p.type not in ('custom_script','gtm')
                  or coalesce((select l.raw_script_pixels_allowed from workspace_limits l
                               where l.workspace_id = s.workspace_id), true))), '[]'::jsonb)
         else '[]'::jsonb end
  from hit h
  join surveys s     on s.id = h.id
  join workspaces w  on w.id = s.workspace_id
  join survey_versions v on v.id = s.latest_published_version_id
  cross join lateral survey_effective_state(s, w.archived_at is not null) e
  left join survey_aliases cur on cur.survey_id = s.id and cur.retired_at is null
  where e.state <> 'draft' and w.deleted_at is null;
$$;

create or replace function get_public_definition(p_version_id uuid, p_key text)
returns table (version_id uuid, version_no int, public_definition jsonb)
language sql stable security definer set search_path = public as $$
  select v.id, v.version_no, v.public_definition
  from resolve_public_survey(p_key) r
  join survey_versions v on v.survey_id = r.survey_id
  where v.id = p_version_id
    and v.status = 'published'
    and (r.effective_state = 'open'
         or (r.state_reason = 'schedule' and now() < r.closes_at + interval '15 minutes'));
$$;

grant execute on function resolve_public_survey(text)       to anon, authenticated, service_role;
grant execute on function get_public_definition(uuid, text) to anon, authenticated, service_role;
```

- Unknown keys, drafts, and archived surveys return zero rows, identical to each other, so holding the public Supabase key never enumerates surveys. There is no host argument (one domain, R1).
- The page calls `resolve_public_survey` on every request (state depends on `now()`), then `get_public_definition` by version id inside a forever cache, because published versions are immutable. The key is an argument, so a version id alone is useless without its survey's link.
- `get_public_definition` accepts any published version of the keyed survey, not only the latest, so a partial resumes against the version it started on (doc 03). The 15 minute grace applies to scheduled closes only (doc 02).
- Cap reached shows as `closed` with reason `cap`; `surveys.state` is not changed (R10). An archived workspace or an admin-closed survey also shows `closed`; a workspace with `deleted_at` set resolves to nothing.
- Per R15 both functions are called from the public hostname; nothing here depends on the host.
- The organization privacy notice at `/privacy` is a static page the server renders from `platform_settings` with the service role and caches; it carries no survey data, so it does not need an anon path.

**Service role** writes responses, answers, files, events only through `submit_response`, `create_upload`, `record_events`, called from Next.js route handlers after Turnstile, honeypot, and rate limiting.

## 12. SQL functions

```sql
admin_create_workspace(p_name text, p_slug text, p_owner uuid, p_request_id uuid default null) returns uuid
```
Platform admin only (doc 05: no self-serve creation). `p_owner` may be an active or pending profile; a pending owner is activated. Inserts the workspace, the owner `workspace_members` row (guard flag `survey.owner_write`), and the built-in contact views; marks the `workspace_requests` row approved when given. Writes `platform_audit_log`. No limits or plan checks.

```sql
transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid) returns void
rename_workspace_slug(p_workspace_id uuid, p_slug text) returns void
admin_set_workspace_limits(p_workspace_id uuid, p_limits jsonb, p_note text) returns void
admin_close_survey(p_survey_id uuid, p_reason text) returns void
admin_approve_access_request(p_request_id uuid) returns void
```
Transfer: the owner, or a platform admin who need not be a member (forced transfer, doc 05); the target must already be a member; the old owner becomes admin; a forced transfer writes both `activity_log` and `platform_audit_log`. The `admin_*` functions require `is_platform_admin()`, write `platform_audit_log`, and `admin_set_workspace_limits` requires a non-empty note. `admin_close_survey` sets `admin_closed_at` and `admin_closed_reason` only (state untouched) and is logged in both logs. Lifecycle functions are in section 2.

```sql
handle_new_user() returns trigger   -- after insert on auth.users
claim_pending_invite() returns jsonb                 -- "Check again" on /pending: email match only
claim_platform_invite(p_token text) returns jsonb   -- /invite/{token}
accept_workspace_invite(p_token text) returns jsonb -- /join/{token}
```
`handle_new_user` creates the profile (name and avatar from OAuth metadata, Fresno 00017 style) and calls the shared internal `apply_invites(user_id, email, workspace_token, platform_token)`. A profile activates when any of these is valid: an open `platform_invites` row whose `email` matches; a `platform_invites` token (`/invite/{token}`); a `workspace_invites` token (`/join/{token}`). Email/password signup passes tokens in `options.data`. Google OAuth cannot, so both invite pages store the token in an HttpOnly cookie and the auth callback calls `claim_platform_invite` or `accept_workspace_invite`; all three claim functions are thin wrappers over `apply_invites`. It also re-checks email-matched platform invites for a pending user on every sign-in (Fresno 00012 fix). An invite is open when `revoked_at is null`, `expires_at > now()`, and for workspace invites `used_count < max_uses`; platform invites are single use (`used_at`, `used_by`). Email match only activates the invited address; a token claim succeeds for whichever account signs in, and the admin list flags the mismatch by comparing `email` with the claimant's auth email (doc 05). Claiming locks the row `for update`, inserts the membership for workspace invites (no-op if already a member, never downgrades), and activates the profile. Returns `{status, workspace_id}`.

```sql
create_survey(p_workspace_id uuid, p_title text, p_template_id uuid default null) returns uuid
set_survey_alias(p_survey_id uuid, p_alias text) returns void         -- null clears (retires)
take_draft_lock(p_version_id uuid, p_force boolean default false) returns jsonb
release_draft_lock(p_version_id uuid) returns void
save_draft(p_version_id uuid, p_expected_revision int, p_definition jsonb) returns int
```
`create_survey` (E) creates the survey plus version 1 draft, copying `definition` from a template the caller can read, else an empty definition with `workspaces.default_theme`. The others are described in sections 3 and 4.

```sql
publish_survey_version(p_version_id uuid, p_expected_revision int, p_public_definition jsonb) returns uuid  -- new draft id
```
Caller must be `E` and hold the lock (or it is expired). Steps: lock the survey row `for update`; check `revision = p_expected_revision`; validate `definition` shape (pages array, every question key matches `^q_[a-z0-9]{8}$`, keys unique, option ids unique per question, identity keys point at email or phone questions, size and question count within `effective_limits`); apply the key stability check against earlier `questions` rows; check `p_public_definition` contains no server-only key (section 4); raise `survey.publishing`; set `status = 'published'`, `public_definition`, `published_at`, `published_by`, `definition_hash`, clear the lock; insert `questions` rows; set `surveys.latest_published_version_id`; insert the cloned draft and set `surveys.current_draft_version_id`; log `publish`. Publishing does not change `surveys.state`.

```sql
delete_survey(p_survey_id uuid) returns void
```
`A`. Raises `survey.purge` and deletes; file rows cascade and enqueue their paths.

```sql
create_upload(p_payload jsonb) returns jsonb   -- service role only (doc 02 section 6)
```
Checks the question is a file question in that version, size and MIME fit the question and `effective_limits`, and the response (by resume token) has fewer than `max_files_per_response` files. Inserts a `response_files` row with `status = 'pending'` and returns `{file_id, object_path}`; the route mints the signed upload URL.

```sql
submit_response(p_payload jsonb) returns jsonb   -- service role only
```
One entry point for both doc 02 actions (`save` and `complete`; the route maps them to validator modes `partial` and `final` per R4). Payload: `action`, `survey_id`, `survey_version_id`, `idempotency_key`, optional `resume_token_hash`, optional `respondent_token`, `respondent_hash`, `answers` (`{question_key: value}`), `visible_keys` (computed by the route with doc 03's engine), `metadata`, `ip`, `file_ids`, `started_at`. Returns doc 02's `SubmitResult` shape `{ok, code?, response_id, resume_token?, score?}`. In one transaction:

1. Insert `submission_idempotency (key, survey_id) on conflict do nothing`; if the key existed, return its stored `result`.
2. Lock the survey `for update`. Version must be published and belong to it. `survey_effective_state` must be `open`, or `closed` by schedule within 15 minutes for a response started before `closes_at`. Otherwise `survey_closed` or `not_open_yet`.
3. Validate: no unknown keys; on `complete`, every `required` question in `visible_keys` has a value; values cast to the question's storage column; choice values are known option ids; file ids belong to this survey, are pending or already on this response, and match their question, with real size and MIME read from `storage.objects.metadata`.
4. Token: not revoked or expired, complete responses for it `< max_responses`, else `token_invalid` or `token_used`. A token's open partial is resumed instead of creating a second one.
5. `save`: create or update the `partial` response (first save generates the resume secret; only its hash is stored), replace answers for keys sent, attach files, update `last_question_key`. Never touches contacts.
6. `complete`: `update surveys set complete_count = complete_count + 1 where id = ... and (response_cap is null or complete_count < response_cap)`; zero rows returns `cap_reached` (R10, the only cap). Resolve the contact (section 5), bump `response_count` and `last_response_at`. Set `complete`, `submitted_at`, `identity_source`, `score` and `score_max` from the server half of the definition, `raw = p_payload` minus `ip` and secrets, `ip` only if `workspaces.store_ip`, null `resume_token_hash`. Replace answers, attach files, set `events.response_id` for this rid, insert the `complete` event.
7. Store the result on the idempotency row and return it.

```sql
rate_limit_hit(p_bucket text, p_key text, p_window interval, p_max int) returns boolean  -- service role only
```
Doc 02's sliding window with `pg_advisory_xact_lock`. The per-survey hourly submission limit reads `rate_limit_per_hour` from `effective_limits`.

```sql
merge_contacts(p_survivor uuid, p_merged uuid[], p_field_choices jsonb default '{}') returns void
```
`E`, 2 to 5 contacts in one workspace, none merged or tombstoned. Moves `responses`, `respondent_tokens` (dropping duplicates on `(survey_id, contact_id)`), `contact_notes` to the survivor. Applies `p_field_choices`, else fills survivor blanks from losers; unions `tags`; `custom = loser.custom || survivor.custom` (survivor wins); `lead_status` takes the most advanced (doc 04). Inserts a `contact_aliases` row per loser and re-points older aliases that pointed at a loser. Sets `merged_into`, `merged_at` on losers and nulls their email and phone so the unique index frees up. Recomputes counters. Logs `merge`.

```sql
erase_respondent(p_contact_id uuid, p_mode text) returns table (deletion_id bigint, bucket text, path text)  -- 'hard' | 'anonymize'
export_respondent_data(p_contact_id uuid) returns jsonb
```
`A`. Accepts an alias id and resolves it. Erase returns the `storage_deletions` rows it enqueued; the route deletes those objects immediately and marks them done.
- `hard`: deletes the contact's responses (answers and file rows cascade), their events, tokens, notes, aliases, and the contact row.
- `anonymize` (Fresno 00004 tombstone, field list in doc 04 section 7.4): keeps responses for aggregates; nulls `ip`, `respondent_hash`, `resume_token_hash`; strips `metadata` to `device`, `utm_*`; redacts `raw`; deletes answers to identity, email, phone, contact-mapped, `is_pii`, and open text questions plus all file answers and files; nulls `response_id` and `respondent_hash` on related events; sets the contact to `status = 'deleted'`, `deleted_at = now()`, personal fields null, `tags '{}'`, `custom '{}'`, `lead_status 'lost'`, owner and follow-up null; deletes notes, aliases, tokens; rewrites the contact's `activity_log` diffs to `{"redacted": true}`.

Both modes log `erase` with counts and a sha256 of the email, never the erased values. `export_respondent_data` builds doc 04's GDPR JSON and logs it.

```sql
retention_batch(p_workspace_id uuid, p_limit int default 1000) returns table (deletion_id bigint, bucket text, path text)
storage_sweep_batch(p_limit int default 500) returns table (deletion_id bigint, bucket text, path text)
complete_storage_deletions(p_done bigint[], p_failed jsonb default '[]') returns void
```
Service role only, called from Vercel Cron (section 13). `retention_batch` deletes up to `p_limit` responses of a workspace older than `retention_days` by `coalesce(submitted_at, started_at)`, deletes their events, lets answers and file rows cascade (the trigger enqueues paths), and returns that workspace's undone `storage_deletions`. `storage_sweep_batch` deletes `pending` `response_files` older than 24 hours, enqueues export files older than 7 days and import CSVs older than 30 days (nulling `storage_path`), and returns undone rows across all workspaces with `attempts < 10`. `complete_storage_deletions` sets `done_at` or increments `attempts` with `last_error`. Contacts are never deleted by retention.

Also: `record_events`, `set_contact_custom`, `search_contacts` (security invoker), `contact_duplicate_candidates`, `import_contacts_chunk`, `filtered_responses`, `version_questions`, `shared_report_payload` (service role only), and `platform_storage_usage()` (PA, bytes per workspace from `storage.objects`). Minting a password reset link is a route handler using the Supabase admin API after an `is_platform_admin()` check, not a SQL function.

Added by migration 0018 (Phase 2 follow-ups; the module that asked is in parentheses):

```sql
log_export(p_workspace_id uuid, p_kind text, p_scope jsonb, p_row_count int) returns void            -- 2D
finish_import(p_import_id uuid, p_summary jsonb) returns void                                        -- 2D
admin_workspace_stats() returns table (workspace_id, owner_id, member_count, survey_count, response_count, storage_bytes_used)  -- 2A
invite_preview(p_token text) returns table (workspace_name, logo_path, role)                         -- 2A
workspace_members_with_email(p_workspace_id uuid) returns table (user_id, role, display_name, avatar_url, status, email, invite_id, joined_at)  -- 2A
pending_storage_deletions(p_workspace_id uuid) returns table (deletion_id, bucket, path)              -- 2A, service role
admin_issue_platform_invite(p_email text default null, p_note text default null, p_expires_in_days int default 30) returns platform_invites  -- 2A
admin_revoke_platform_invite(p_invite_id uuid) returns void                                          -- 2A
admin_update_privacy_notice(p_markdown text) returns void                                            -- 2A
admin_set_abuse_report_status(p_report_id uuid, p_status text) returns void                          -- 2A
admin_dismiss_access_request(p_request_id uuid) returns void                                         -- 2A
admin_dismiss_workspace_request(p_request_id uuid) returns void                                      -- 2A
hash_share_password(p_password text) returns text                                                    -- 2E
report_share_gate(p_token text, p_password text default null) returns table (status, report_id)      -- 2E, service role
multi_choice_ids(p_json jsonb) returns jsonb                                                         -- 2C, helper
```
`log_export` needs editor for row level kinds (`responses`, `contacts`) and viewer for aggregate kinds (`summary`, `report`), matching doc 05. `finish_import` sets `status` (`done` or `failed`), `finished_at`, and any counts given. The `admin_*` functions check `is_platform_admin()` and write `platform_audit_log` themselves. `report_share_gate` returns `not_found`, `needs_password` or `open` (with the report id) and counts the view; `shared_report_payload` no longer counts views. Changed in place: `answer_row` (multiple_choice `{ids, other}`), `resolve_public_survey` (adds `workspace_id`), `filtered_responses` (contact custom field filters), `shared_report_payload` (matrix labels), `reserved_public_segments` (adds `welcome`).

### Assignments (R19, R20)

Added by migration 0020. Table `survey_assignments(survey_id, workspace_id, user_id, kind, assigned_by, assigned_at)`, primary key `(survey_id, user_id)`, `kind` in `owner` or `collaborator`, partial unique index `survey_one_owner`, cascades from surveys, workspaces and profiles. Members read under RLS; there is no client write path. The guard copies `workspace_id` from the survey and refuses an assignee who is not an active member (`assignee_not_member`). The creator becomes the owner (after insert trigger on `surveys`; `create_survey` is unchanged), and the migration backfills existing surveys whose creator is still an active member.

```sql
set_survey_owner(p_survey_id uuid, p_user_id uuid) returns void              -- editor; previous owner stays as collaborator
add_survey_collaborator(p_survey_id uuid, p_user_id uuid) returns void       -- editor; no-op if already one
remove_survey_collaborator(p_survey_id uuid, p_user_id uuid) returns void    -- editor; no-op if not one
member_owned_survey_counts(p_workspace_id uuid) returns table (user_id, owned_surveys)   -- viewer; live surveys only
directory_profiles() returns table (id, display_name, avatar_url)           -- active callers; active profiles; never email
add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void          -- owner or admin, role at or below caller, never owner
admin_add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void    -- PA, never owner
admin_remove_workspace_member(p_workspace_id uuid, p_user_id uuid) returns void                        -- PA, never the owner
admin_set_member_role(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void         -- PA, never owner
```
Assignment functions write `activity_log` (entity `survey`, actions `assignment.owner`, `assignment.collaborator_add`, `assignment.collaborator_remove`, `assignment.reassign`); `add_workspace_member` writes `member` `add`; the `admin_*` functions write `platform_audit_log` (`member.add`, `member.remove`, `member.role_change`). An after delete trigger on `workspace_members` drops the leaver's collaborator rows and moves surveys they owned to the remover, or to the workspace owner when they left on their own or the remover is not a member. New error codes: `assignee_not_member`, `invalid_role`, `already_member`, `target_not_active`.

## 13. Scheduled jobs (R3)

Two runners with a clear line: pg_cron runs pure SQL that never touches Storage; Vercel Cron runs anything that must call the Storage API.

**pg_cron** (scheduled in migration 0016):

| Job | Schedule | Work |
|---|---|---|
| `prune_rate_limits` | every 15 min | delete `rate_limit_events` older than 2 hours |
| `prune_idempotency` | hourly | delete `submission_idempotency` older than 24 hours |
| `prune_aliases` | daily | delete `survey_aliases` retired more than 30 days ago |
| `expire_resume_tokens` | daily | null `resume_token_hash` on partials older than 30 days |
| `rollup_events` | daily 02:00 UTC | roll events older than 180 days into `event_daily`, delete them |
| `prune_activity_log` | weekly | delete `activity_log` older than 400 days (doc 05) |
| `prune_slug_history` | daily | delete `workspace_slug_history` older than 30 days |
| `reconcile_storage_bytes` | daily | set `workspaces.storage_bytes_used` from `storage.objects` sizes under each `{workspace_id}/` prefix (read only, no deletes) |
| `prune_storage_deletions` | daily | delete done `storage_deletions` older than 7 days |

**Vercel Cron** (route handlers authenticated with `CRON_SECRET`, service role client):

| Route | Schedule | Work |
|---|---|---|
| `/api/cron/retention` | daily 03:00 UTC | for each workspace with `retention_days`, loop `retention_batch`, delete files through the Storage API, `complete_storage_deletions`, stop at 250 s |
| `/api/cron/workspace-purge` | daily 04:00 UTC | for each id from `workspace_purge_due`, call `purge_workspace`, then drain its `storage_deletions` through the Storage API |
| `/api/cron/storage-sweep` | hourly | loop `storage_sweep_batch`, delete files, mark done; retry moves of attached files still under `/pending/` |

## 14. Realtime

Only `responses` joins `supabase_realtime`. The inbox subscribes with `filter: survey_id=eq.<id>`. Postgres Changes evaluates the subscriber's RLS for every change, so the select policy (`is_member(workspace_id,'viewer')`) is what keeps workspaces apart; it must stay a cheap single lookup. Payloads include `raw`, so the inbox treats the event as a signal and refetches the row with answers. `answers`, `events`, and `survey_versions` are not published. Lock takeover is detected by the builder's autosave response (`revision_conflict`). Doc 03's editor presence uses a Realtime presence channel, which needs no table.

## 15. Migration plan

1. `0001_extensions_enums.sql`: pgcrypto, pg_trgm, pg_cron, all enums, default privilege revokes for anon, `touch_updated_at`, `gen_token`.
2. `0002_identity.sql`: profiles, platform_invites, platform_settings, platform_audit_log, access_requests, guard trigger, `is_platform_admin`, `is_active_profile`.
3. `0003_workspaces.sql`: workspaces, workspace_slug_history, members, invites, workspace_limits, workspace_requests, activity_log, `log_activity`, `is_member`, `shares_workspace`, `effective_limits`, member guard, lifecycle guard, `admin_create_workspace`, `transfer_workspace_ownership`, `rename_workspace_slug`, `archive_workspace`, `unarchive_workspace`, `request_workspace_deletion`, `restore_workspace`, `admin_set_workspace_limits`, `admin_approve_access_request`.
4. `0004_signup_and_invites.sql`: `apply_invites`, `handle_new_user` trigger, `claim_pending_invite`, `claim_platform_invite`, `accept_workspace_invite`.
5. `0005_surveys.sql`: surveys, survey_versions, questions, survey_aliases, survey_templates (plus system template seeds), slug generator, guards, `survey_effective_state`, `create_survey`, `set_survey_alias`, `take_draft_lock`, `release_draft_lock`, `save_draft`.
6. `0006_publish.sql`: `publish_survey_version`, `delete_survey`, alias retire-on-delete trigger, `admin_close_survey`.
7. `0007_contacts.sql`: contacts, contact_aliases, contact_notes, respondent_tokens, contact_field_defs, contact_views (built-in view seeds per workspace via `admin_create_workspace`), contact_duplicate_dismissals, contact_imports, `set_contact_custom`, `search_contacts`, `contact_duplicate_candidates`, `import_contacts_chunk`, owner cleanup trigger.
8. `0008_responses.sql`: responses, answers, response_files, storage_deletions and its trigger, submission_idempotency, rate_limit_events, storage buckets and policies.
9. `0009_events.sql`: events, event_daily, stopwords seed, `record_events`.
10. `0010_pixels.sql`: workspace_pixels, raw script kill switch trigger, abuse_reports.
11. `0011_public_read.sql`: `resolve_public_survey`, `get_public_definition`, anon grants on exactly those two.
12. `0012_submission.sql`: `rate_limit_hit`, `create_upload`, `submit_response`.
13. `0013_reports_exports.sql`: reports, report_widgets, report_shares, export_jobs, `filtered_responses`, `version_questions`, `shared_report_payload`.
14. `0014_privacy.sql`: `merge_contacts`, `erase_respondent`, `export_respondent_data`.
15. `0015_storage_jobs.sql`: `retention_batch`, `storage_sweep_batch`, `complete_storage_deletions`, `platform_storage_usage`, `workspace_purge_due`, `purge_workspace`.
16. `0016_cron.sql`: the pg_cron schedules in section 13.
17. `0017_realtime.sql`: add responses to `supabase_realtime`.

18. `0018_phase2_followups.sql`: see "Migration 0018" below.

A test after 0017 asserts `anon` holds no table privilege in `public` and exactly two function privileges.

### Migration 0018

Phase 2 follow-ups, requested in the build plan's running notes:

- **multiple_choice Other text (2C).** `answer_row` accepts `[ids]` or `{ids, other}` and stores `value_json` as `[ids]` when Other is blank, else `{ids, other}`; single choice `{id, other}` stores `value_text` plus `value_json {other}`. Unknown option ids still raise `unknown_option`. Every reader of multiple_choice `value_json` (score sum and contact mapping in `submit_response_core`, `report_widget_data`, `filtered_responses`) goes through `multi_choice_ids`. Anonymize in `erase_respondent` strips Other text from kept choice answers.
- **Public read (2C).** `resolve_public_survey` returns `workspace_id` as its last column (dropped and recreated; grants unchanged, anon still holds exactly two functions).
- **Reports (2E).** `filtered_responses` adds `contact.custom: [{key, op: eq|contains, value}]`. `shared_report_payload` adds `rows` and `columns` ({id, label}) for matrix widgets and reduces `options` to {id, label}. `hash_share_password` stores bcrypt; `report_share_gate` is the service role gate for `/r/{token}`.
- **Exports and imports (2D).** `log_export`, `finish_import`.
- **Admin (2A).** `admin_workspace_stats`, `invite_preview`, `workspace_members_with_email`, `pending_storage_deletions`, and the self-auditing `admin_*` writes listed in section 12. `reserved_public_segments()` adds `welcome` (`join` was already there), matching `DASHBOARD_SEGMENTS`.

Tested by `supabase/tests/09_phase2_followups.sql`.

## Decisions made here

- **Postgres enums with role order by declaration.** `role >= p_min_role` is the whole role check.
- **`is_platform_admin` flag on profiles.** Someone has to manage invites and workspaces; a full platform role system is overkill.
- **Platform invites carry both an optional email and a token.** Google accounts often differ from the invited address.
- **Invites via metadata for email signup, cookie plus doc 05's claim functions for OAuth.** OAuth cannot carry signup metadata.
- **Workspace lifecycle timing lives in one guard trigger.** Archive, 7 days, delete request, 30 day restore, cron purge; no function can skip a step.
- **`is_member` returns false for deleted workspaces and allows only viewer checks on archived ones.** Archive freezes writes everywhere RLS reaches without touching each policy.
- **Deleted surveys and purged workspaces hold their aliases and slug for 30 days.** Printed links cannot be taken over right after a delete.
- **`platform_audit_log` is separate and unscoped; `abuse_reports` is service role write, platform admin read.** Both must outlive workspaces, and the public form must not confirm which slugs exist.
- **Anon reads only through `resolve_public_survey` and `get_public_definition`, key as argument (R1).** No table grants means no enumeration and no column-grant drift.
- **Pixels ride inside `resolve_public_survey`.** Keeps anon at exactly two functions; doc 02's `get_public_pixels` is folded in.
- **Privacy and pixel settings are columns on `workspaces`.** Same writer, same lifetime, read together on every public request.
- **Limits are SQL constants plus nullable overrides in `workspace_limits`, read through `effective_limits`.** No config table to seed; overrides are rare and platform admin only. The raw script pixel kill switch lives there too (doc 05 dropped feature flags).
- **Slugs are lowercase `[a-z0-9]{10}`; aliases are global with a 30 day hold enforced by the unique index over retired rows.** One domain, one namespace, no hijacking of printed links.
- **Drafts change only through `save_draft` with a revision check; takeover bumps revision.** One path for concurrency instead of a policy plus a trigger.
- **`publish_survey_version` takes the split `public_definition` from the route and verifies it.** `splitDefinition` is TypeScript (doc 03); SQL checks the revision and the server-only key list.
- **Questions snapshot written only at publish; drafts are JSON only.** Keeps autosave cheap and the snapshot trustworthy.
- **Key reuse across storage columns is a publish error; option ids are stable.** Protects cross-version reports.
- **Server validates required fields against `visible_keys` from the route handler.** Logic lives in TypeScript (doc 03); SQL cannot run it.
- **One `submit_response` for save and complete.** Idempotency, token, and state checks are shared; doc 02's contract adopted.
- **One `response_files` table for pending and attached uploads.** Doc 02's `pending_uploads` and the earlier `response_files` were the same row at two moments.
- **`identity_source` and rid are columns, not metadata keys.** Report filters stay indexable.
- **Tombstone is `contacts.status = 'deleted'` plus `deleted_at`.** Doc 04's status column, with the timestamp kept for audits.
- **Phone is indexed, not unique.** Households share numbers (doc 04).
- **Partials never create contacts; contact upsert fills blanks only.** Avoids junk contacts and protects curated CRM data.
- **Erase requires admin and keeps a tombstone in anonymize mode.** Irreversible; attribution joins keep working (Fresno 00004).
- **File deletes go through a `storage_deletions` outbox filled by trigger.** Cascades can never orphan a file, and a crashed cron run resumes.
- **pg_cron for pure SQL pruning and rollups, Vercel Cron for anything touching Storage (R3).**
- **Realtime on `responses` only.** Smallest surface that powers a live inbox.
- **Events not partitioned in v1; BRIN on time, 180 day raw window.** Revisit at tens of millions of rows.

## Open questions for the owner

Answered by doc 05 and removed: viewers read contacts; only platform admins create workspaces; row-level export needs editor while aggregate export is open to viewers; `activity_log` keeps 400 days.

1. Abandoned partial responses and their files are kept until workspace retention removes them (forever by default). Should partials have a shorter fixed lifetime, for example 30 days (doc 04 question 8)?
