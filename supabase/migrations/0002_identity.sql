-- 0002: identity. profiles, platform invites and settings, platform audit log,
-- access requests, the profile guard, is_platform_admin, is_active_profile.
-- Spec: docs/01-data-model.md section 2, docs/05-workspaces-and-admin.md.
-- The profiles select policy needs shares_workspace(), so it is created in 0003.

create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null default 'New user',
  avatar_url        text,
  status            profile_status not null default 'pending',
  is_platform_admin boolean not null default false,
  last_workspace_id uuid,                      -- where `/` lands; fk added in 0003
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();

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
create trigger platform_settings_touch before update on platform_settings
  for each row execute function touch_updated_at();
insert into platform_settings (id) values (true) on conflict (id) do nothing;

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

create table access_requests (           -- an uninvited (pending) sign-in asks for access
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  department  text check (department is null or length(department) <= 120),
  reason      text check (reason is null or length(reason) <= 2000),
  status      text not null default 'open' check (status in ('open','approved','dismissed')),
  invite_id   uuid references platform_invites(id) on delete set null,   -- invite minted on approval
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index access_requests_one_open on access_requests (user_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Helpers (after the tables they read)
-- ---------------------------------------------------------------------------
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = auth.uid() and is_platform_admin and status = 'active');
$$;

create or replace function is_active_profile() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;
grant execute on function is_platform_admin(), is_active_profile() to authenticated, service_role;

-- Internal: audit row for platform admin actions.
create or replace function write_platform_audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into platform_audit_log (actor, action, target_type, target_id, details)
  values ((select id from profiles where id = auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'));
$$;

-- ---------------------------------------------------------------------------
-- guard_profile_privileges: non platform admins cannot change status or
-- is_platform_admin; status = 'disabled' is refused while the user owns any
-- workspace (transfer first). Internal functions raise survey.profile_write.
-- Trusted callers (service role, SQL editor) may change both, which is how the
-- first platform admin is promoted (see supabase/seed.sql).
-- ---------------------------------------------------------------------------
create or replace function guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable';
  end if;
  if (new.status is distinct from old.status or new.is_platform_admin is distinct from old.is_platform_admin)
     and not (is_trusted_caller() or flag_on('survey.profile_write') or is_platform_admin()) then
    raise exception 'Only a platform admin can change status or platform admin rights';
  end if;
  if new.is_platform_admin and not old.is_platform_admin and new.status <> 'active' then
    raise exception 'Only an active profile can be a platform admin';
  end if;
  if new.status = 'disabled' and old.status is distinct from 'disabled'
     and exists (select 1 from workspace_members m where m.user_id = new.id and m.role = 'owner') then
    raise exception 'Transfer ownership of every workspace before disabling this user';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table profiles           enable row level security;
alter table platform_invites   enable row level security;
alter table platform_settings  enable row level security;
alter table platform_audit_log enable row level security;
alter table access_requests    enable row level security;

-- profiles: select policy in 0003 (needs shares_workspace). Insert by trigger only.
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_platform_admin())
  with check (id = auth.uid() or is_platform_admin());

create policy platform_invites_select on platform_invites for select to authenticated using (is_platform_admin());
create policy platform_invites_insert on platform_invites for insert to authenticated
  with check (is_platform_admin() and used_at is null and used_by is null);
create policy platform_invites_update on platform_invites for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy platform_invites_delete on platform_invites for delete to authenticated using (is_platform_admin());

create policy platform_settings_select on platform_settings for select to authenticated using (is_active_profile());
create policy platform_settings_update on platform_settings for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

create policy platform_audit_select on platform_audit_log for select to authenticated using (is_platform_admin());

create policy access_requests_select on access_requests for select to authenticated
  using (user_id = auth.uid() or is_platform_admin());
create policy access_requests_insert on access_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and invite_id is null
              and reviewed_by is null and reviewed_at is null);
create policy access_requests_update on access_requests for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
