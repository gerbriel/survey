-- 0003: workspaces, slug history, members, invites, limits, workspace
-- requests, activity log, membership helpers, guards, lifecycle and admin
-- functions. Spec: docs/01-data-model.md sections 2, 10, 11, 12;
-- docs/05-workspaces-and-admin.md.

create table workspaces (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (length(btrim(name)) between 1 and 80),
  slug                   text not null unique check (
                           slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40
                           and slug not in ('admin','api','app','auth','new','settings','welcome','pending',
                                            'invite','join','privacy','report','s','w','r')),   -- doc 05
  logo_path              text,                -- public-assets/{workspace_id}/logo-{hash}.{ext}
  default_theme          jsonb not null default '{}',   -- Theme shape owned by doc 03
  default_closed_message text check (default_closed_message is null or length(default_closed_message) <= 1000),
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
create trigger workspaces_touch before update on workspaces
  for each row execute function touch_updated_at();

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

create table workspace_requests (        -- doc 05: a member asks platform admins for a new workspace
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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function is_member(p_workspace_id uuid, p_min_role workspace_role default 'viewer')
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
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

-- profiles policy: can I see this other user?
create or replace function shares_workspace(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from workspace_members a join workspace_members b using (workspace_id)
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- Role of the caller in a workspace ignoring archive state (lifecycle
-- functions need it because is_member is read only while archived).
create or replace function caller_role(p_workspace_id uuid) returns workspace_role
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role
  from workspace_members m join profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id and m.user_id = auth.uid() and p.status = 'active';
$$;

-- Global limits (docs/00 "Global limits"). A test keeps these constants equal
-- to src/lib/limits.ts. A null override column means "use the default".
create or replace function effective_limits(p_workspace_id uuid)
returns table (max_file_bytes bigint, max_files_per_response int, max_questions int,
               max_definition_bytes int, rate_limit_per_hour int, raw_script_pixels_allowed boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(l.max_file_bytes, 26214400),
         coalesce(l.max_files_per_response, 20),
         coalesce(l.max_questions, 300),
         coalesce(l.max_definition_bytes, 1048576),
         coalesce(l.rate_limit_per_hour, 20),
         coalesce(l.raw_script_pixels_allowed, true)
  from (select 1) d
  left join workspace_limits l on l.workspace_id = p_workspace_id
  where auth.role() = 'service_role' or auth.uid() is null or is_member(p_workspace_id) or is_platform_admin();
$$;

grant execute on function is_member(uuid, workspace_role), shares_workspace(uuid), caller_role(uuid)
  to authenticated, service_role;
grant execute on function effective_limits(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- activity_log writer. Generic after trigger; diff holds changed fields only.
-- Deletes record no values. Skipped while survey.purge or survey.skip_log is
-- raised (purges, erasure, merges write their own rows).
-- ---------------------------------------------------------------------------
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new    jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old    jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row    jsonb;
  v_ws     uuid;
  v_entity text;
  v_eid    uuid;
  v_action text;
  v_diff   jsonb := '{}';
  v_skip   text[] := array['updated_at','created_at','definition','parsed','password_hash',
                           'storage_bytes_used','storage_reconciled_at'];
  v_quiet  text[] := '{}';
begin
  if flag_on('survey.purge') or flag_on('survey.skip_log') then
    return null;
  end if;
  v_row := coalesce(v_new, v_old);
  if tg_table_name = 'workspaces' then
    if tg_op = 'DELETE' then return null; end if;
    v_ws := (v_row ->> 'id')::uuid;
  else
    v_ws := (v_row ->> 'workspace_id')::uuid;
  end if;
  if v_ws is null then
    return null;   -- system templates, unscoped rows
  end if;

  v_entity := case tg_table_name
    when 'surveys'            then 'survey'
    when 'survey_aliases'     then 'alias'
    when 'survey_templates'   then 'template'
    when 'contacts'           then 'contact'
    when 'contact_notes'      then 'contact'
    when 'contact_field_defs' then 'contact_field'
    when 'workspace_members'  then 'member'
    when 'workspace_invites'  then 'invite'
    when 'workspaces'         then 'workspace'
    when 'workspace_pixels'   then 'pixel'
    when 'workspace_limits'   then 'limits'
    when 'reports'            then 'report'
    when 'report_shares'      then 'share'
    else tg_table_name end;
  v_eid := case tg_table_name
    when 'contact_notes'     then (v_row ->> 'contact_id')::uuid
    when 'workspace_members' then (v_row ->> 'user_id')::uuid
    when 'workspace_limits'  then (v_row ->> 'workspace_id')::uuid
    else (v_row ->> 'id')::uuid end;
  v_action := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;

  if tg_op <> 'DELETE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}')
      into v_diff
      from jsonb_each(v_new) n
      left join jsonb_each(coalesce(v_old, '{}'::jsonb)) o on o.key = n.key
     where n.value is distinct from o.value
       and not (n.key = any (v_skip))
       and not (tg_op = 'INSERT' and n.value = 'null'::jsonb);
  end if;

  if tg_op = 'UPDATE' then
    v_quiet := case tg_table_name
      when 'surveys'  then array['complete_count','current_draft_version_id','latest_published_version_id']
      when 'contacts' then array['response_count','last_response_at','lead_status_changed_at']
      else '{}'::text[] end;
    if not exists (select 1 from jsonb_object_keys(v_diff) k where not (k = any (v_quiet))) then
      return null;   -- nothing worth logging (counters, pointers, timestamps)
    end if;
    if tg_table_name = 'contacts' and v_diff ? 'lead_status' then
      v_action := 'status_change';
    elsif tg_table_name = 'contacts' and v_diff ? 'owner_id' then
      v_action := 'owner_change';
    end if;
  end if;
  if tg_table_name = 'contact_notes' then
    v_action := 'note.' || v_action;
  end if;

  insert into activity_log (workspace_id, actor, entity, entity_id, action, diff)
  values (v_ws, (select id from profiles where id = auth.uid()), v_entity, v_eid, v_action, v_diff);
  return null;
end $$;

-- Internal: explicit activity row from functions.
create or replace function write_activity(p_workspace_id uuid, p_entity text, p_entity_id uuid, p_action text, p_diff jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into activity_log (workspace_id, actor, entity, entity_id, action, diff)
  values (p_workspace_id, (select id from profiles where id = auth.uid()), p_entity, p_entity_id, p_action, coalesce(p_diff, '{}'));
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle guard (doc 01 section 2), extended to keep bookkeeping columns
-- (storage counters, creator, deleted_by) out of client hands.
-- ---------------------------------------------------------------------------
create or replace function guard_workspace_lifecycle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
  if not (is_trusted_caller() or flag_on('survey.internal') or flag_on('survey.lifecycle')) then
    if new.id is distinct from old.id
       or new.storage_bytes_used is distinct from old.storage_bytes_used
       or new.storage_reconciled_at is distinct from old.storage_reconciled_at
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.deleted_by is distinct from old.deleted_by then
      raise exception 'These workspace columns are maintained by the system';
    end if;
    if new.pixel_notice_ack_at is distinct from old.pixel_notice_ack_at
       and new.pixel_notice_ack_at is not null then
      new.pixel_notice_ack_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
create trigger workspaces_lifecycle before update or delete on workspaces
  for each row execute function guard_workspace_lifecycle();
create trigger workspaces_activity after insert or update on workspaces
  for each row execute function log_activity();

-- ---------------------------------------------------------------------------
-- Member guard. Exactly one owner: only admin_create_workspace and
-- transfer_workspace_ownership write role = 'owner' (flag survey.owner_write).
-- Admins manage editors and viewers; promoting to admin, and demoting or
-- removing an admin, is owner only (doc 05 section 2.2).
-- ---------------------------------------------------------------------------
create or replace function guard_workspace_member() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'workspace_id and user_id are immutable';
  end if;
  if (tg_op = 'INSERT' and new.role = 'owner')
     or (tg_op = 'UPDATE' and new.role is distinct from old.role and (new.role = 'owner' or old.role = 'owner'))
     or (tg_op = 'DELETE' and old.role = 'owner') then
    if not (flag_on('survey.owner_write') or flag_on('survey.purge')) then
      raise exception 'The owner changes only through admin_create_workspace or transfer_workspace_ownership';
    end if;
    return coalesce(new, old);
  end if;
  if is_trusted_caller() or flag_on('survey.internal') or flag_on('survey.purge') then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Members join through invite links';
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and (old.role = 'admin' or new.role = 'admin') and not is_member(v_ws, 'owner') then
    raise exception 'Only the owner can promote to or demote from admin';
  end if;
  if tg_op = 'DELETE' and old.role = 'admin' and old.user_id <> auth.uid()
     and not is_member(v_ws, 'owner') then
    raise exception 'Only the owner can remove an admin';
  end if;
  return coalesce(new, old);
end $$;
create trigger workspace_members_guard before insert or update or delete on workspace_members
  for each row execute function guard_workspace_member();
create trigger workspace_members_activity after insert or update or delete on workspace_members
  for each row execute function log_activity();

-- Invites: clients may only revoke or relabel; counters move inside apply_invites.
create or replace function guard_workspace_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not (is_trusted_caller() or flag_on('survey.internal')) then
      new.used_count := 0;
      new.revoked_at := null;
      new.created_by := auth.uid();
    end if;
    return new;
  end if;
  if not (is_trusted_caller() or flag_on('survey.internal')) then
    if new.workspace_id <> old.workspace_id or new.token <> old.token or new.role <> old.role
       or new.used_count <> old.used_count or new.max_uses <> old.max_uses
       or new.created_by is distinct from old.created_by or new.expires_at <> old.expires_at then
      raise exception 'Only revoked_at and label can change on an invite';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'A revoked invite stays revoked';
    end if;
  end if;
  return new;
end $$;
create trigger workspace_invites_guard before insert or update on workspace_invites
  for each row execute function guard_workspace_invite();
create trigger workspace_invites_activity after insert or update or delete on workspace_invites
  for each row execute function log_activity();
create trigger workspace_limits_activity after insert or update or delete on workspace_limits
  for each row execute function log_activity();

-- ---------------------------------------------------------------------------
-- Workspace functions
-- ---------------------------------------------------------------------------

-- Slug is free when it is not live and not held in history (by another workspace).
create or replace function workspace_slug_available(p_slug text, p_workspace_id uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from workspaces where slug = p_slug and id is distinct from p_workspace_id)
     and not exists (select 1 from workspace_slug_history h
                     where h.slug = p_slug
                       and (h.workspace_id is null or p_workspace_id is null
                            or h.workspace_id <> p_workspace_id));
$$;
grant execute on function workspace_slug_available(text, uuid) to authenticated, service_role;

create or replace function admin_create_workspace(p_name text, p_slug text, p_owner uuid, p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws     uuid;
  v_slug   text := lower(btrim(p_slug));
  v_status profile_status;
begin
  if not (is_platform_admin() or is_service_role()) then
    raise exception 'not_authorized';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid_name';
  end if;
  if v_slug is null or not workspace_slug_available(v_slug) then
    raise exception 'slug_taken';
  end if;
  select status into v_status from profiles where id = p_owner for update;
  if v_status is null or v_status not in ('active', 'pending') then
    raise exception 'invalid_owner';
  end if;

  insert into workspaces (name, slug, created_by)
  values (btrim(p_name), v_slug, (select id from profiles where id = auth.uid()))
  returning id into v_ws;

  perform set_config('survey.owner_write', 'on', true);
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, p_owner, 'owner');
  perform set_config('survey.owner_write', 'off', true);

  if v_status = 'pending' then
    perform set_config('survey.profile_write', 'on', true);
    update profiles set status = 'active' where id = p_owner;
    perform set_config('survey.profile_write', 'off', true);
  end if;

  if p_request_id is not null then
    update workspace_requests
       set status = 'approved', workspace_id = v_ws, reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id and status = 'open';
    if not found then
      raise exception 'invalid_request_id';
    end if;
  end if;

  perform write_platform_audit('workspace.create', 'workspace', v_ws,
    jsonb_build_object('name', btrim(p_name), 'slug', v_slug, 'owner', p_owner, 'request_id', p_request_id));
  -- Built-in contact views are inserted by the workspaces_builtin_views trigger (0007).
  return v_ws;
end $$;

create or replace function transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_owner uuid;
  v_forced    boolean;
begin
  if not exists (select 1 from workspaces where id = p_workspace_id and deleted_at is null) then
    raise exception 'not_found';
  end if;
  select user_id into v_old_owner from workspace_members
   where workspace_id = p_workspace_id and role = 'owner' for update;
  v_forced := caller_role(p_workspace_id) is distinct from 'owner';
  if v_forced and not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_new_owner is null or p_new_owner = v_old_owner then
    raise exception 'invalid_target';
  end if;
  if not exists (select 1 from workspace_members m join profiles p on p.id = m.user_id
                 where m.workspace_id = p_workspace_id and m.user_id = p_new_owner and p.status = 'active') then
    raise exception 'target_not_member';
  end if;

  perform set_config('survey.owner_write', 'on', true);
  update workspace_members set role = 'admin' where workspace_id = p_workspace_id and user_id = v_old_owner;
  update workspace_members set role = 'owner' where workspace_id = p_workspace_id and user_id = p_new_owner;
  perform set_config('survey.owner_write', 'off', true);

  perform write_activity(p_workspace_id, 'workspace', p_workspace_id,
    case when v_forced then 'ownership.force_transfer' else 'ownership.transfer' end,
    jsonb_build_object('from', v_old_owner, 'to', p_new_owner));
  if v_forced then
    perform write_platform_audit('ownership.force_transfer', 'workspace', p_workspace_id,
      jsonb_build_object('from', v_old_owner, 'to', p_new_owner));
  end if;
end $$;

create or replace function rename_workspace_slug(p_workspace_id uuid, p_slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_slug text := lower(btrim(p_slug));
  v_old  text;
begin
  if not is_member(p_workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  select slug into v_old from workspaces where id = p_workspace_id for update;
  if v_slug is null or v_slug = v_old then
    return;
  end if;
  if not workspace_slug_available(v_slug, p_workspace_id) then
    raise exception 'slug_taken';
  end if;
  delete from workspace_slug_history where slug = v_slug and workspace_id = p_workspace_id;  -- reclaiming an old slug
  insert into workspace_slug_history (slug, workspace_id, released_at) values (v_old, p_workspace_id, now())
    on conflict (slug) do update set workspace_id = excluded.workspace_id, released_at = excluded.released_at;
  perform set_config('survey.lifecycle', 'on', true);
  update workspaces set slug = v_slug where id = p_workspace_id;
  perform set_config('survey.lifecycle', 'off', true);
end $$;

create or replace function archive_workspace(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pa boolean := is_platform_admin();
begin
  if not (caller_role(p_workspace_id) = 'owner' or v_pa) then
    raise exception 'not_authorized';
  end if;
  perform set_config('survey.lifecycle', 'on', true);
  update workspaces set archived_at = now()
   where id = p_workspace_id and archived_at is null and deleted_at is null;
  if not found then
    raise exception 'invalid_state';
  end if;
  perform set_config('survey.lifecycle', 'off', true);
  if v_pa then
    perform write_platform_audit('workspace.archive', 'workspace', p_workspace_id);
  end if;
end $$;

create or replace function unarchive_workspace(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pa boolean := is_platform_admin();
begin
  if not (caller_role(p_workspace_id) = 'owner' or v_pa) then
    raise exception 'not_authorized';
  end if;
  perform set_config('survey.lifecycle', 'on', true);
  update workspaces set archived_at = null
   where id = p_workspace_id and archived_at is not null and deleted_at is null;
  if not found then
    raise exception 'invalid_state';
  end if;
  perform set_config('survey.lifecycle', 'off', true);
  if v_pa then
    perform write_platform_audit('workspace.unarchive', 'workspace', p_workspace_id);
  end if;
end $$;

create or replace function request_workspace_deletion(p_workspace_id uuid, p_confirm_slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pa   boolean := is_platform_admin();
  v_slug text;
begin
  if not (caller_role(p_workspace_id) = 'owner' or v_pa) then
    raise exception 'not_authorized';
  end if;
  select slug into v_slug from workspaces where id = p_workspace_id and deleted_at is null for update;
  if v_slug is null then
    raise exception 'not_found';
  end if;
  if p_confirm_slug is distinct from v_slug then
    raise exception 'confirm_slug_mismatch';
  end if;
  perform set_config('survey.lifecycle', 'on', true);
  update workspaces set deleted_at = now(), deleted_by = auth.uid() where id = p_workspace_id;
  perform set_config('survey.lifecycle', 'off', true);
  perform write_activity(p_workspace_id, 'workspace', p_workspace_id, 'delete_requested');
  if v_pa then
    perform write_platform_audit('workspace.delete_request', 'workspace', p_workspace_id);
  end if;
end $$;

create or replace function restore_workspace(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  perform set_config('survey.lifecycle', 'on', true);
  update workspaces set deleted_at = null, deleted_by = null
   where id = p_workspace_id and deleted_at is not null;
  if not found then
    raise exception 'invalid_state';
  end if;
  perform set_config('survey.lifecycle', 'off', true);
  perform write_activity(p_workspace_id, 'workspace', p_workspace_id, 'restore');
  perform write_platform_audit('workspace.restore', 'workspace', p_workspace_id);
end $$;

create or replace function admin_set_workspace_limits(p_workspace_id uuid, p_limits jsonb, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed text[] := array['max_file_bytes','max_files_per_response','max_questions',
                            'max_definition_bytes','rate_limit_per_hour','raw_script_pixels_allowed'];
  v_bad text;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'note_required';
  end if;
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'invalid_limits';
  end if;
  select k into v_bad from jsonb_object_keys(p_limits) k where not (k = any (v_allowed)) limit 1;
  if v_bad is not null then
    raise exception 'unknown_limit: %', v_bad;
  end if;
  if not exists (select 1 from workspaces where id = p_workspace_id) then
    raise exception 'not_found';
  end if;
  insert into workspace_limits as l (workspace_id, max_file_bytes, max_files_per_response, max_questions,
                                     max_definition_bytes, rate_limit_per_hour, raw_script_pixels_allowed,
                                     note, updated_by, updated_at)
  values (p_workspace_id,
          (p_limits ->> 'max_file_bytes')::bigint,
          (p_limits ->> 'max_files_per_response')::int,
          (p_limits ->> 'max_questions')::int,
          (p_limits ->> 'max_definition_bytes')::int,
          (p_limits ->> 'rate_limit_per_hour')::int,
          (p_limits ->> 'raw_script_pixels_allowed')::boolean,
          btrim(p_note), auth.uid(), now())
  on conflict (workspace_id) do update set
    max_file_bytes = excluded.max_file_bytes,
    max_files_per_response = excluded.max_files_per_response,
    max_questions = excluded.max_questions,
    max_definition_bytes = excluded.max_definition_bytes,
    rate_limit_per_hour = excluded.rate_limit_per_hour,
    raw_script_pixels_allowed = excluded.raw_script_pixels_allowed,
    note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  perform write_platform_audit('limits.update', 'workspace', p_workspace_id,
    jsonb_build_object('limits', p_limits, 'note', btrim(p_note)));
end $$;

create or replace function admin_approve_access_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req    access_requests;
  v_email  text;
  v_invite uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  select * into v_req from access_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'invalid_state';
  end if;
  select lower(btrim(email)) into v_email from auth.users where id = v_req.user_id;
  -- The invite is claimed at once, so it never sits open in the email index.
  insert into platform_invites (email, note, invited_by, used_at, used_by)
  values (v_email, 'Approved access request', auth.uid(), now(), v_req.user_id)
  returning id into v_invite;
  perform set_config('survey.profile_write', 'on', true);
  update profiles set status = 'active' where id = v_req.user_id and status = 'pending';
  perform set_config('survey.profile_write', 'off', true);
  update access_requests set status = 'approved', invite_id = v_invite, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request_id;
  perform write_platform_audit('access_request.approve', 'user', v_req.user_id,
    jsonb_build_object('request_id', p_request_id, 'invite_id', v_invite));
end $$;

grant execute on function admin_create_workspace(text, text, uuid, uuid),
  transfer_workspace_ownership(uuid, uuid), rename_workspace_slug(uuid, text),
  archive_workspace(uuid), unarchive_workspace(uuid), request_workspace_deletion(uuid, text),
  restore_workspace(uuid), admin_set_workspace_limits(uuid, jsonb, text),
  admin_approve_access_request(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table workspaces             enable row level security;
alter table workspace_slug_history enable row level security;
alter table workspace_members      enable row level security;
alter table workspace_invites      enable row level security;
alter table workspace_limits       enable row level security;
alter table workspace_requests     enable row level security;
alter table activity_log           enable row level security;

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_workspace(id) or is_platform_admin());

create policy workspaces_select on workspaces for select to authenticated
  using (is_member(id) or is_platform_admin());
create policy workspaces_update on workspaces for update to authenticated
  using (is_member(id, 'admin')) with check (is_member(id, 'admin'));

create policy workspace_slug_history_select on workspace_slug_history for select to authenticated
  using (workspace_id is not null and is_member(workspace_id));

create policy workspace_members_select on workspace_members for select to authenticated
  using (is_member(workspace_id));
create policy workspace_members_update on workspace_members for update to authenticated
  using (is_member(workspace_id, 'admin'))
  with check (is_member(workspace_id, 'admin') and role <> 'owner');
create policy workspace_members_delete on workspace_members for delete to authenticated
  using (is_member(workspace_id, 'admin') or (user_id = auth.uid() and role <> 'owner'));

create policy workspace_invites_select on workspace_invites for select to authenticated
  using (is_member(workspace_id, 'admin'));
create policy workspace_invites_insert on workspace_invites for insert to authenticated
  with check (is_member(workspace_id, 'admin') and (role <> 'admin' or is_member(workspace_id, 'owner')));
create policy workspace_invites_update on workspace_invites for update to authenticated
  using (is_member(workspace_id, 'admin')) with check (is_member(workspace_id, 'admin'));
create policy workspace_invites_delete on workspace_invites for delete to authenticated
  using (is_member(workspace_id, 'admin'));

create policy workspace_limits_select on workspace_limits for select to authenticated
  using (is_member(workspace_id) or is_platform_admin());

create policy workspace_requests_select on workspace_requests for select to authenticated
  using (requested_by = auth.uid() or is_platform_admin());
create policy workspace_requests_insert on workspace_requests for insert to authenticated
  with check (is_active_profile() and requested_by = auth.uid() and status = 'open'
              and workspace_id is null and reviewed_by is null and reviewed_at is null);
create policy workspace_requests_update on workspace_requests for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

create policy activity_log_select on activity_log for select to authenticated
  using (is_member(workspace_id, 'admin'));
