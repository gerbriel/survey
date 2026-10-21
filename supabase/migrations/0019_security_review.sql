-- 0019: fixes from the security review (docs/07-security-review.md, owner
-- I3-SQL). Evidence and sketches: docs/security/review-sql.md,
-- review-public.md, review-dashboard.md. Rulings R16, R17, R18 in
-- docs/00-decisions.md. Every change carries the finding id it closes.
--
--   S1 (R18)  apply_invites claims by email only for a provider-verified email
--   S3 (R16)  raw script kill switch defaults to off, covers custom_script and gtm
--   S4        submission_idempotency never stores the resume secret
--   S5        reports.survey_id must be in the row's workspace and is immutable
--   S7        invite visibility by role; secret columns scrubbed from activity_log
--   S10       upload caps count pending files; bucket size and type limits;
--             attach checks the stored size against the declared size
--   Low       L-1, L-3/D-12, L-5, L-6, L-8/D-13, L-9, L-10, L-12, L-13, D-07, I6
--
-- Same discipline as 0018: SECURITY DEFINER with search_path = public,
-- pg_temp, input checks, explicit grants. Function bodies copied from earlier
-- migrations keep their signatures; only the commented lines change.
-- Messages that are not SQL_ERROR_CODES entries are English sentences.

-- ===========================================================================
-- S1 (R18). Invite claiming requires a verified email
-- ===========================================================================
-- Email confirmation is off (no email provider), so a password signup's email
-- proves nothing. An address counts as verified only when Google OAuth vouched
-- for it:
--   * an auth.identities row with provider 'google' for this user whose
--     identity_data email equals the user's email and is not marked unverified
--     (covers claim_pending_invite after sign-in and later identity linking), or
--   * while no identity row exists yet (inside the auth.users insert trigger,
--     GoTrue writes identities after the user row), raw_app_meta_data.provider
--     = 'google' and raw_user_meta_data.email_verified is not false.
-- raw_app_meta_data is written by GoTrue only. raw_user_meta_data alone is
-- never trusted: a password signUp copies options.data into it, so a client
-- can send email_verified: true. If the trigger runs before GoTrue sets the
-- provider, the profile stays pending and the next sign-in's
-- claim_pending_invite() call claims it through the identities row.
-- Stand-in note: the Postgres 17 stand-in's shim needs auth.users
-- raw_app_meta_data and an auth.identities table; real Supabase has both.
create or replace function signup_verified_email(p_user_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(btrim(u.email))
  from auth.users u
  where u.id = p_user_id
    and nullif(btrim(u.email), '') is not null
    and (
      exists (select 1 from auth.identities i
              where i.user_id = u.id and i.provider = 'google'
                and lower(btrim(i.identity_data ->> 'email')) = lower(btrim(u.email))
                and coalesce(i.identity_data ->> 'email_verified', 'true') <> 'false')
      or (not exists (select 1 from auth.identities i where i.user_id = u.id)
          and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
          and coalesce(u.raw_user_meta_data ->> 'email_verified', 'true') <> 'false'));
$$;
revoke all on function signup_verified_email(uuid) from public, anon, authenticated;

-- S1 (R18). apply_invites from 0004; step 3 needs a verified email.
create or replace function apply_invites(p_user_id uuid, p_email text, p_workspace_token text, p_platform_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status   profile_status;
  v_email    text := nullif(lower(btrim(p_email)), '');
  v_result   text;
  v_ws       uuid;
  v_winv     workspace_invites;
  v_pinv     platform_invites;
  v_activate boolean := false;
begin
  if p_user_id is null then
    raise exception 'user required';
  end if;
  select status into v_status from profiles where id = p_user_id for update;
  if v_status is null then
    raise exception 'profile not found';
  end if;
  if v_status in ('disabled', 'deleted') then
    return jsonb_build_object('status', 'disabled', 'workspace_id', null);
  end if;

  -- S1 (R18): the email match in step 3 only uses an address the identity
  -- provider verified. Token claims (steps 1 and 2) are unchanged.
  if v_email is distinct from signup_verified_email(p_user_id) then
    v_email := null;
  end if;

  -- 1. Workspace invite token
  if nullif(btrim(p_workspace_token), '') is not null then
    select i.* into v_winv
      from workspace_invites i join workspaces w on w.id = i.workspace_id
     where i.token = btrim(p_workspace_token)
       and i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses
       and w.deleted_at is null and w.archived_at is null
     for update of i;
    if v_winv.id is null then
      v_result := 'invalid';
    else
      v_ws := v_winv.workspace_id;
      if exists (select 1 from workspace_members where workspace_id = v_ws and user_id = p_user_id) then
        v_result := 'already_member';
      else
        perform set_config('survey.internal', 'on', true);
        insert into workspace_members (workspace_id, user_id, role, invite_id)
        values (v_ws, p_user_id, v_winv.role, v_winv.id);
        update workspace_invites set used_count = used_count + 1 where id = v_winv.id;
        perform set_config('survey.internal', 'off', true);
        v_result := 'joined';
      end if;
      v_activate := true;
    end if;
  end if;

  -- 2. Platform invite token (single use; a repeat claim by the same user is a no-op)
  if nullif(btrim(p_platform_token), '') is not null then
    select * into v_pinv from platform_invites where token = btrim(p_platform_token) for update;
    if v_pinv.id is not null and v_pinv.used_by = p_user_id then
      v_activate := true;
      v_result := coalesce(v_result, 'activated');
    elsif v_pinv.id is null or v_pinv.revoked_at is not null or v_pinv.expires_at <= now() or v_pinv.used_at is not null then
      v_result := coalesce(v_result, 'invalid');
    else
      update platform_invites set used_at = now(), used_by = p_user_id where id = v_pinv.id;
      v_activate := true;
      v_result := coalesce(v_result, 'activated');
    end if;
  end if;

  -- 3. Email match (only activates the invited address)
  if not v_activate and v_status = 'pending' and v_email is not null then
    select * into v_pinv from platform_invites
     where email = v_email and used_at is null and revoked_at is null and expires_at > now()
     order by created_at
     limit 1
     for update skip locked;
    if v_pinv.id is not null then
      update platform_invites set used_at = now(), used_by = p_user_id where id = v_pinv.id;
      v_activate := true;
      v_result := coalesce(v_result, 'activated');
    end if;
  end if;

  if v_activate and v_status = 'pending' then
    perform set_config('survey.profile_write', 'on', true);
    update profiles set status = 'active' where id = p_user_id;
    perform set_config('survey.profile_write', 'off', true);
    v_status := 'active';
  end if;

  if v_result is null then
    v_result := case when v_status = 'active' then 'active' else 'pending' end;
  end if;
  return jsonb_build_object('status', v_result, 'workspace_id', v_ws);
end $$;

-- ===========================================================================
-- S3 (R16). Raw script kill switch: off by default, custom_script and gtm
-- ===========================================================================
-- Every workspace starts with script pixels blocked; only a platform admin
-- turns them on per workspace (admin_set_workspace_limits). Existing rows,
-- including any earlier explicit true, are reset so each workspace is
-- re-approved under the cross-workspace warning. Enforcement is by the
-- pixel type column only, never by parsed content.
alter table workspace_limits alter column raw_script_pixels_allowed set default false;
update workspace_limits set raw_script_pixels_allowed = false
 where raw_script_pixels_allowed is distinct from false;
comment on column workspace_limits.raw_script_pixels_allowed is
  'R16 kill switch for custom_script and gtm pixels; null or false = blocked, true = a platform admin allowed them';
-- L-1: parsed is never kept on non custom_script rows.
update workspace_pixels set parsed = null where type <> 'custom_script' and parsed is not null;

-- S3 (R16). effective_limits from 0003; the kill switch defaults to off.
create or replace function effective_limits(p_workspace_id uuid)
returns table (max_file_bytes bigint, max_files_per_response int, max_questions int,
               max_definition_bytes int, rate_limit_per_hour int, raw_script_pixels_allowed boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(l.max_file_bytes, 26214400),
         coalesce(l.max_files_per_response, 20),
         coalesce(l.max_questions, 300),
         coalesce(l.max_definition_bytes, 1048576),
         coalesce(l.rate_limit_per_hour, 20),
         coalesce(l.raw_script_pixels_allowed, false)
  from (select 1) d
  left join workspace_limits l on l.workspace_id = p_workspace_id
  where auth.role() = 'service_role' or auth.uid() is null or is_member(p_workspace_id) or is_platform_admin();
$$;

-- S3 (R16). guard_workspace_pixel from 0010; switch defaults to off, parsed
-- kept only for custom_script.
create or replace function guard_workspace_pixel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- L-1 with S3: parsed is only meaningful for custom_script; any other type
  -- never carries script parts, whatever the client sent.
  if new.type <> 'custom_script' then
    new.parsed := null;
  end if;
  if new.enabled and new.type in ('custom_script', 'gtm')
     and (tg_op = 'INSERT' or not old.enabled or old.type is distinct from new.type or old.value is distinct from new.value)
     and not coalesce((select l.raw_script_pixels_allowed from workspace_limits l where l.workspace_id = new.workspace_id), false) then
    raise exception 'raw_script_pixels_disabled';
  end if;
  if tg_op = 'INSERT' and not is_trusted_caller() then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.created_by is distinct from old.created_by) then
    raise exception 'workspace_id and created_by are immutable';
  end if;
  return new;
end $$;

-- S3 (R16). resolve_public_survey from 0018, same signature. custom_script and
-- gtm rows are dropped by their type column unless the platform admin turned
-- the switch on (null now means off); parsed is returned for custom_script only.
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
  pixels             jsonb,               -- [{id,type,value,parsed}], enabled minus excluded; [] unless open
  workspace_id       uuid                 -- Phase 2C: spares the public routes a second lookup
)
language sql stable security definer set search_path = public, pg_temp as $$
  with k as (
    select lower(btrim(p_key)) as key
    where p_key is not null and length(p_key) between 1 and 100
  ),
  hit as (
    select h.id, h.matched_by
    from (
      select s.id, 'slug'::text as matched_by, 0 as prio from surveys s, k where s.slug = k.key
      union all
      select a.survey_id, case when a.retired_at is null then 'alias' else 'retired_alias' end, 1
      from survey_aliases a, k
      where a.alias = k.key
        and a.survey_id is not null
        and (a.retired_at is null or a.retired_at > now() - interval '30 days')
    ) h
    order by h.prio
    limit 1
  )
  select s.id, s.slug, cur.alias, h.matched_by,
         e.state, e.reason, s.opens_at, s.closes_at,
         coalesce(s.closed_message, w.default_closed_message),
         case when e.state = 'open' then v.id end,
         case when e.state = 'open' then v.version_no end,
         coalesce(v.public_definition #>> '{settings,title}', v.public_definition ->> 'title', s.title),
         s.og_title, s.og_description, s.og_image_path, s.allow_indexing,
         w.name, w.logo_path, w.show_powered_by, w.privacy_notice_url, w.pixel_consent_mode,
         case when e.state = 'open' then coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type,
                                               'value', p.value,
                                               'parsed', case when p.type = 'custom_script' then p.parsed end)
                            order by p.created_at)
           from workspace_pixels p
           where p.workspace_id = s.workspace_id and p.enabled
             and not (p.id = any (s.excluded_pixel_ids))
             and (p.type not in ('custom_script','gtm')
                  or coalesce((select l.raw_script_pixels_allowed from workspace_limits l
                               where l.workspace_id = s.workspace_id), false))), '[]'::jsonb)
         else '[]'::jsonb end,
         w.id
  from hit h
  join surveys s     on s.id = h.id
  join workspaces w  on w.id = s.workspace_id
  join survey_versions v on v.id = s.latest_published_version_id
  cross join lateral survey_effective_state(s, w.archived_at is not null) e
  left join survey_aliases cur on cur.survey_id = s.id and cur.retired_at is null
  where e.state <> 'draft' and w.deleted_at is null;
$$;

-- ===========================================================================
-- S4. The resume secret never sits in submission_idempotency
-- ===========================================================================
-- First call: the handler gets the secret once, as before. Stored result:
-- the same object minus resume_token. Replay: the stored result plus
-- replayed = true, never a secret. A client whose first reply was lost saves
-- again and gets a new partial.
update submission_idempotency set result = result - 'resume_token' where result ? 'resume_token';

-- S4. submit_response from 0012: store the result without the resume secret.
create or replace function submit_response(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
  v_sid    uuid;
  v_idem   uuid;
  v_prev   submission_idempotency;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  begin
    v_action := p_payload ->> 'action';
    v_sid := (p_payload ->> 'survey_id')::uuid;
    v_idem := (p_payload ->> 'idempotency_key')::uuid;
    perform (p_payload ->> 'survey_version_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  if v_action is null or v_action not in ('save', 'complete') or v_sid is null or v_idem is null
     or p_payload ->> 'survey_version_id' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not exists (select 1 from surveys where id = v_sid) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into submission_idempotency (key, survey_id) values (v_idem, v_sid) on conflict (key) do nothing;
  if not found then
    select * into v_prev from submission_idempotency where key = v_idem;
    if v_prev.survey_id <> v_sid or v_prev.result is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    -- S4: a replay never carries the resume secret and says it is a replay.
    return (v_prev.result - 'resume_token') || jsonb_build_object('replayed', true);
  end if;

  v_result := submit_response_core(p_payload, v_action);
  update submission_idempotency
     set result = v_result - 'resume_token',   -- S4: the plaintext secret is never stored
         response_id = case when v_result ->> 'response_id' is not null then (v_result ->> 'response_id')::uuid end
   where key = v_idem;
  return v_result;
end $$;

-- ===========================================================================
-- S5. reports.survey_id stays inside the report's workspace
-- ===========================================================================
-- Rows planted before this migration (survey in another workspace) are
-- removed; no legitimate path creates them.
delete from reports r using surveys s
 where s.id = r.survey_id and s.workspace_id <> r.workspace_id;

drop policy reports_insert on reports;
create policy reports_insert on reports for insert to authenticated
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from surveys s where s.id = survey_id and s.workspace_id = reports.workspace_id));
drop policy reports_update on reports;
create policy reports_update on reports for update to authenticated
  using (is_member(workspace_id, 'editor'))
  with check (is_member(workspace_id, 'editor')   -- S5: same survey check as insert
              and exists (select 1 from surveys s where s.id = survey_id and s.workspace_id = reports.workspace_id));

-- S5 and L-5: survey_id, workspace_id and created_by never move; created_by
-- is the caller on a client insert.
create or replace function guard_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not (is_trusted_caller() or flag_on('survey.internal')) then
      new.created_by := auth.uid();
    end if;
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.survey_id <> old.survey_id
     or new.created_by is distinct from old.created_by or new.id <> old.id then
    raise exception 'workspace_id, survey_id and created_by are immutable on a report';
  end if;
  return new;
end $$;
drop trigger if exists reports_guard on reports;
create trigger reports_guard before insert or update on reports
  for each row execute function guard_report();

-- ===========================================================================
-- L-5. Immutability guards on client-writable contact tables
-- ===========================================================================
-- merge_contacts moves notes to the survivor under survey.internal.
create or replace function guard_contact_note() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_trusted_caller() or flag_on('survey.internal') then
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.contact_id <> old.contact_id
     or new.author is distinct from old.author or new.id <> old.id then
    raise exception 'workspace_id, contact_id and author are immutable on a note';
  end if;
  return new;
end $$;
drop trigger if exists contact_notes_guard on contact_notes;
create trigger contact_notes_guard before update on contact_notes
  for each row execute function guard_contact_note();

-- Keys never change (doc 04 section 1.4); a type change would strand stored values.
create or replace function guard_contact_field_def() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_trusted_caller() or flag_on('survey.internal') then
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.key <> old.key or new.type <> old.type or new.id <> old.id then
    raise exception 'workspace_id, key and type are immutable; archive the field and create a new one';
  end if;
  return new;
end $$;
drop trigger if exists contact_field_defs_guard on contact_field_defs;
create trigger contact_field_defs_guard before update on contact_field_defs
  for each row execute function guard_contact_field_def();

-- A viewer may keep personal views but never publish one (shared is editor only).
drop policy contact_views_update on contact_views;
create policy contact_views_update on contact_views for update to authenticated
  using ((created_by = auth.uid() and is_member(workspace_id)) or (shared and is_member(workspace_id, 'editor')))
  with check ((not shared and created_by = auth.uid() and is_member(workspace_id))
              or (is_member(workspace_id, 'editor') and (shared or created_by = auth.uid())));

-- L-5. guard_workspace_lifecycle from 0003 with pixel_notice_ack_by system owned.
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
    -- L-5: pixel_notice_ack_by is always written by the system: the caller when
    -- the acknowledgement is (re)given, cleared with it, untouched otherwise.
    if new.pixel_notice_ack_at is distinct from old.pixel_notice_ack_at
       and new.pixel_notice_ack_at is not null then
      new.pixel_notice_ack_by := auth.uid();
    elsif new.pixel_notice_ack_at is null then
      new.pixel_notice_ack_by := null;
    else
      new.pixel_notice_ack_by := old.pixel_notice_ack_by;
    end if;
  end if;
  return new;
end $$;

-- ===========================================================================
-- S7. Invite visibility and secrets in activity_log
-- ===========================================================================
-- D-03: admins see invites they created and invites for roles below their
-- own; owners see every invite. An admin can no longer copy an owner-created
-- admin invite link.
drop policy workspace_invites_select on workspace_invites;
create policy workspace_invites_select on workspace_invites for select to authenticated
  using (is_member(workspace_id, 'admin')
         and (created_by = auth.uid()
              or is_member(workspace_id, 'owner')
              or role < caller_role(workspace_id)));

-- D-08, L-2: a column is secret when it is named token, secret, password or
-- salt, ends in _token, _secret, _password, _salt or _hash, or starts with
-- password_ or secret_. Covers workspace_invites.token,
-- report_shares.token and password_hash, respondent_tokens.token,
-- platform_invites.token and responses.resume_token_hash wherever audited.
create or replace function is_secret_column(p_name text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_name, '') ~ '^(token|secret|password|salt)$'
      or coalesce(p_name, '') ~ '_(token|secret|password|salt|hash)$'
      or coalesce(p_name, '') ~ '^(password|secret)_';
$$;
revoke all on function is_secret_column(text) from public, anon;
grant execute on function is_secret_column(text) to authenticated, service_role;

-- S7. log_activity from 0003; secret-like columns are scrubbed for every
-- audited table (invites, shares, and any later table with such a column).
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
       and not is_secret_column(n.key)   -- S7: tokens, hashes, passwords never logged
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

-- D-07. guard_workspace_invite from 0003; token and expiry are server side.
create or replace function guard_workspace_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not (is_trusted_caller() or flag_on('survey.internal')) then
      new.used_count := 0;
      new.revoked_at := null;
      new.created_by := auth.uid();
      -- D-07: the token is always generated here; a client value is ignored.
      -- The expiry keeps the 1, 7 or 30 day choice but is clamped to at most
      -- 30 days, and a past or missing expiry becomes the 7 day default.
      new.token := gen_token(24);
      new.created_at := now();
      if new.expires_at is null or new.expires_at <= now() then
        new.expires_at := now() + interval '7 days';
      elsif new.expires_at > now() + interval '30 days' then
        new.expires_at := now() + interval '30 days';
      end if;
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

-- S7: scrub secrets already copied into activity_log.
update activity_log l
   set diff = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                 from jsonb_each(l.diff) e where not is_secret_column(e.key))
 where jsonb_typeof(l.diff) = 'object'
   and exists (select 1 from jsonb_object_keys(l.diff) k where is_secret_column(k));

-- D-07 for platform invites: the token is generated here and the expiry is
-- at most 90 days (admin_issue_platform_invite already uses 1 to 90).
create or replace function guard_platform_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (is_trusted_caller() or flag_on('survey.internal')) then
    new.token := gen_token(24);
    new.used_at := null;
    new.used_by := null;
    new.revoked_at := null;
    new.created_at := now();
    if new.expires_at is null or new.expires_at <= now() then
      new.expires_at := now() + interval '30 days';
    elsif new.expires_at > now() + interval '90 days' then
      new.expires_at := now() + interval '90 days';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists platform_invites_guard on platform_invites;
create trigger platform_invites_guard before insert on platform_invites
  for each row execute function guard_platform_invite();

-- ===========================================================================
-- S10. Upload caps, bucket limits, attach-time size check
-- ===========================================================================
-- A pending upload minted with a resume token records the partial it belongs
-- to, so create_upload can count pending plus attached files. The check
-- (status = 'attached') = (response_id is not null) is unchanged; this is a
-- separate column, nulled if the partial goes away.
alter table response_files add column if not exists pending_response_id uuid
  references responses(id) on delete set null;
create index if not exists response_files_pending_response on response_files (pending_response_id)
  where pending_response_id is not null;

-- Bucket limits: response-files accepts at most the largest per-file size any
-- workspace may use (the 25 MB default from effective_limits, or a larger
-- platform admin override) and exactly the server MIME allowlist
-- (upload_mime_allowed). public-assets keeps 10 MB images, exports and
-- imports are unchanged. The trigger below keeps the size in step when a
-- platform admin changes max_file_bytes.
create or replace function sync_response_files_bucket() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update storage.buckets
     set file_size_limit = (select greatest(26214400, coalesce(max(l.max_file_bytes), 0)) from workspace_limits l)
   where id = 'response-files';
  return null;
end $$;
revoke all on function sync_response_files_bucket() from public, anon, authenticated;
drop trigger if exists workspace_limits_bucket_sync on workspace_limits;
create trigger workspace_limits_bucket_sync after insert or update of max_file_bytes or delete on workspace_limits
  for each statement execute function sync_response_files_bucket();

update storage.buckets
   set file_size_limit = (select greatest(26214400, coalesce(max(l.max_file_bytes), 0)) from workspace_limits l),
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','application/pdf','text/plain','text/csv',
         'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']
 where id = 'response-files';
update storage.buckets
   set file_size_limit = 10485760, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
 where id = 'public-assets';

-- S10. create_upload from 0012: counts pending plus attached files.
create or replace function create_upload(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        surveys;
  w        workspaces;
  q        questions;
  st       record;
  l        record;
  v_sid    uuid; v_vid uuid;
  v_name   text := btrim(p_payload ->> 'name');
  v_size   bigint;
  v_mime   text := lower(btrim(p_payload ->> 'mime'));
  v_safe   text;
  v_ext    text;
  v_id     uuid := gen_random_uuid();
  v_path   text;
  v_resp   uuid;
  v_maxmb  numeric;
  v_count  int;
  v_qcount int;
  v_qmax   int;
begin
  begin
    v_sid := (p_payload ->> 'survey_id')::uuid;
    v_vid := (p_payload ->> 'survey_version_id')::uuid;
    v_size := (p_payload ->> 'size')::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  if v_sid is null or v_vid is null or v_name is null or v_name = '' or length(v_name) > 255 or v_size is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into s from surveys where id = v_sid;
  select * into w from workspaces where id = s.workspace_id;
  if s.id is null or w.deleted_at is not null
     or not exists (select 1 from survey_versions where id = v_vid and survey_id = v_sid and status = 'published') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into st from survey_effective_state(s, w.archived_at is not null);
  if st.state <> 'open' then
    return jsonb_build_object('ok', false, 'code', case st.state when 'scheduled' then 'not_open_yet'
                                                                when 'draft' then 'not_found' else 'survey_closed' end);
  end if;
  select * into q from questions where survey_version_id = v_vid and question_key = p_payload ->> 'question_key';
  if q.id is null or q.type not in ('file_upload', 'signature') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into l from effective_limits(s.workspace_id);
  v_maxmb := (q.config #>> '{validation,max_file_mb}')::numeric;
  if v_size <= 0 or v_size > l.max_file_bytes
     or (v_maxmb is not null and v_size > v_maxmb * 1048576) then
    return jsonb_build_object('ok', false, 'code', 'file_size');
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{1,10})$'));
  if not upload_mime_allowed(v_mime)
     or (q.type = 'signature' and v_mime <> 'image/png')
     or (jsonb_typeof(q.config #> '{validation,allowed_extensions}') = 'array'
         and not exists (select 1 from jsonb_array_elements_text(q.config #> '{validation,allowed_extensions}') x
                         where lower(x) = v_ext)) then
    return jsonb_build_object('ok', false, 'code', 'file_type');
  end if;
  if nullif(p_payload ->> 'resume_token_hash', '') is not null then
    select id into v_resp from responses
     where resume_token_hash = p_payload ->> 'resume_token_hash' and survey_id = v_sid and status = 'partial'
     for update;   -- S10: serializes concurrent mints for one response
    if v_resp is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    -- S10: pending uploads minted for this response count as well as attached
    -- files, against the per response cap and the question's max_files.
    select count(*), count(*) filter (where question_key = q.question_key)
      into v_count, v_qcount
      from response_files
     where response_id = v_resp or (status = 'pending' and pending_response_id = v_resp);
    if v_count >= l.max_files_per_response then
      return jsonb_build_object('ok', false, 'code', 'file_count');
    end if;
    v_qmax := case when q.type = 'signature' then 1
                   when jsonb_typeof(q.config #> '{validation,max_files}') = 'number'
                   then (q.config #>> '{validation,max_files}')::int end;
    -- Three spare mints per question let a respondent replace files; pending
    -- rows of removed files are not deleted until the orphan sweep.
    if v_qmax is not null and v_qcount >= v_qmax + 3 then
      return jsonb_build_object('ok', false, 'code', 'file_count');
    end if;
  end if;

  v_safe := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9._-]+', '-', 'g'), '-.'), 100);
  if v_safe = '' then v_safe := 'file'; end if;
  v_path := s.workspace_id || '/' || s.id || '/pending/' || v_id || '/' || v_safe;
  insert into response_files (id, workspace_id, survey_id, question_key, object_path, declared_size, declared_mime,
                              original_name, pending_response_id)
  values (v_id, s.workspace_id, s.id, q.question_key, v_path, v_size, v_mime, v_name, v_resp);
  return jsonb_build_object('ok', true, 'file_id', v_id, 'object_path', v_path);
end $$;

-- S10. submit_response_core from 0018 with one change: at attach the Storage
-- object size must equal the declared size.
create or replace function submit_response_core(p_payload jsonb, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s          surveys;
  w          workspaces;
  v          survey_versions;
  r          responses;
  tok        respondent_tokens;
  st         record;
  l          record;
  q          record;
  f          record;
  v_answers  jsonb := coalesce(p_payload -> 'answers', '{}'::jsonb);
  v_rows     jsonb := '{}';
  v_errors   jsonb := '{}';
  v_key      text;
  v_val      jsonb;
  v_row      jsonb;
  v_visible  text[];
  v_file_ids uuid[];
  v_obj      jsonb;
  v_started  timestamptz;
  v_secret   text;
  v_meta     jsonb := sanitize_response_metadata(p_payload -> 'metadata');
  v_rid      text := left(nullif(p_payload ->> 'respondent_hash', ''), 64);
  v_contact  uuid;
  v_source   text;
  v_email    text;
  v_phone    text;
  v_hidden   jsonb;
  v_score    numeric := 0;
  v_max      numeric := 0;
  v_scored   boolean := false;
  v_quizkey  text;
  v_ip       inet;
  v_n        int;
  v_custom   jsonb;
begin
  select * into s from surveys where id = (p_payload ->> 'survey_id')::uuid for update;
  select * into w from workspaces where id = s.workspace_id;
  if s.id is null or w.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v from survey_versions where id = (p_payload ->> 'survey_version_id')::uuid;
  if v.id is null or v.survey_id <> s.id or v.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Existing partial: by resume hash, else the token's open partial.
  if nullif(p_payload ->> 'resume_token_hash', '') is not null then
    select * into r from responses
     where resume_token_hash = p_payload ->> 'resume_token_hash' and survey_id = s.id for update;
    if r.id is null or r.status <> 'partial' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
  end if;
  if nullif(p_payload ->> 'respondent_token', '') is not null then
    select * into tok from respondent_tokens
     where token = p_payload ->> 'respondent_token' and survey_id = s.id for update;
    if tok.id is null or tok.revoked_at is not null or (tok.expires_at is not null and tok.expires_at <= now()) then
      return jsonb_build_object('ok', false, 'code', 'token_invalid');
    end if;
    if (select count(*) from responses where respondent_token_id = tok.id and status = 'complete') >= tok.max_responses then
      return jsonb_build_object('ok', false, 'code', 'token_used');
    end if;
    if r.id is null then
      select * into r from responses
       where respondent_token_id = tok.id and status = 'partial' and survey_version_id = v.id
       order by started_at desc limit 1 for update;
    elsif r.respondent_token_id is not null and r.respondent_token_id <> tok.id then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
  end if;
  if r.id is not null and r.survey_version_id <> v.id then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  begin
    v_started := (p_payload ->> 'started_at')::timestamptz;
  exception when others then
    v_started := null;
  end;
  if v_started is null or v_started > now() or v_started < now() - interval '30 days' then
    v_started := now();
  end if;
  v_started := coalesce(r.started_at, v_started);

  -- State under the survey row lock, with the 15 minute grace for scheduled closes.
  select * into st from survey_effective_state(s, w.archived_at is not null);
  if st.state = 'open' then
    null;
  elsif st.state = 'closed' and st.reason = 'schedule' and now() < s.closes_at + interval '15 minutes'
        and v_started < s.closes_at then
    null;
  elsif st.state = 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_open_yet');
  elsif st.state = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif st.reason = 'cap' then
    return jsonb_build_object('ok', false, 'code', 'cap_reached');
  else
    return jsonb_build_object('ok', false, 'code', 'survey_closed');
  end if;

  -- Answers: no unknown keys, values cast to the storage column.
  for v_key, v_val in select key, value from jsonb_each(v_answers) loop
    select * into q from questions where survey_version_id = v.id and question_key = v_key;
    if q.id is null then
      v_errors := v_errors || jsonb_build_object(v_key, 'unknown_question');
      continue;
    end if;
    if question_storage_column(q.type) = 'none' or q.type in ('file_upload', 'signature') then
      continue;   -- display blocks store nothing; file answers derive from file_ids
    end if;
    begin
      v_row := answer_row(q.type, q.options, q.config, v_val);
    exception when others then
      v_errors := v_errors || jsonb_build_object(v_key, case when sqlerrm ~ '^[a-z_]+$' then sqlerrm else 'type' end);
      continue;
    end;
    v_rows := v_rows || jsonb_build_object(v_key, coalesce(v_row, 'null'::jsonb));
  end loop;

  -- Files: same survey, pending or already on this response, a file question
  -- of this version, real size and MIME from storage.objects.
  begin
    v_file_ids := array(select (jsonb_array_elements_text(coalesce(p_payload -> 'file_ids', '[]'::jsonb)))::uuid);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  select * into l from effective_limits(s.workspace_id);
  for f in select rf.* from response_files rf where rf.id = any (v_file_ids) for update loop
    v_key := f.question_key;
    if f.survey_id <> s.id or (f.status = 'attached' and f.response_id is distinct from r.id)
       or not exists (select 1 from questions where survey_version_id = v.id and question_key = f.question_key
                      and type in ('file_upload', 'signature')) then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_unknown');
      continue;
    end if;
    select o.metadata into v_obj from storage.objects o where o.bucket_id = 'response-files' and o.name = f.object_path;
    if v_obj is null then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_unknown');
    elsif (v_obj ->> 'size') is null or (v_obj ->> 'size')::bigint is distinct from f.declared_size then
      -- S10: the stored object must be exactly the size declared at create_upload.
      v_errors := v_errors || jsonb_build_object(v_key, 'file_size');
    elsif coalesce((v_obj ->> 'size')::bigint, 0) > l.max_file_bytes then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_size');
    elsif not upload_mime_allowed(v_obj ->> 'mimetype') then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_type');
    end if;
  end loop;
  if (select count(*) from response_files where id = any (v_file_ids)) <> coalesce(cardinality(v_file_ids), 0) then
    v_errors := v_errors || jsonb_build_object('_files', 'file_unknown');
  end if;
  if (select count(distinct x) from (
        select id as x from response_files where id = any (v_file_ids)
        union select id from response_files where r.id is not null and response_id = r.id) t) > l.max_files_per_response then
    v_errors := v_errors || jsonb_build_object('_files', 'file_count');
  end if;

  -- Required, only against the logic-visible keys the route computed.
  if p_action = 'complete' then
    v_visible := array(select jsonb_array_elements_text(coalesce(p_payload -> 'visible_keys', '[]'::jsonb)));
    for q in select * from questions
              where survey_version_id = v.id and required and question_key = any (v_visible)
                and question_storage_column(type) <> 'none' loop
      if q.type in ('file_upload', 'signature') then
        if not exists (select 1 from response_files rf
                       where rf.question_key = q.question_key and rf.survey_id = s.id
                         and (rf.id = any (v_file_ids) or (r.id is not null and rf.response_id = r.id))) then
          v_errors := v_errors || jsonb_build_object(q.question_key, 'required');
        end if;
      elsif not answer_has_value(v_rows -> q.question_key) and not v_errors ? q.question_key then
        v_errors := v_errors || jsonb_build_object(q.question_key, 'required');
      end if;
    end loop;
  end if;
  if v_errors <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'validation_failed', 'field_errors', v_errors);
  end if;

  perform set_config('survey.internal', 'on', true);

  -- The only cap (R10).
  if p_action = 'complete' then
    update surveys set complete_count = complete_count + 1
     where id = s.id and (response_cap is null or complete_count < response_cap);
    if not found then
      perform set_config('survey.internal', 'off', true);
      return jsonb_build_object('ok', false, 'code', 'cap_reached');
    end if;
  end if;

  if r.id is null then
    insert into responses (workspace_id, survey_id, survey_version_id, status, respondent_token_id,
                           respondent_hash, started_at, metadata)
    values (s.workspace_id, s.id, v.id, 'partial', tok.id, v_rid, v_started, v_meta)
    returning * into r;
  else
    update responses set metadata = metadata || v_meta, respondent_hash = coalesce(v_rid, respondent_hash),
                         respondent_token_id = coalesce(respondent_token_id, tok.id)
     where id = r.id returning * into r;
  end if;

  -- Answers: save replaces the keys sent; complete replaces everything.
  if p_action = 'complete' then
    delete from answers where response_id = r.id;
  else
    delete from answers where response_id = r.id and question_key in (select jsonb_object_keys(v_rows));
  end if;
  insert into answers (response_id, workspace_id, survey_id, survey_version_id, question_key,
                       value_text, value_number, value_date, value_json)
  select r.id, s.workspace_id, s.id, v.id, e.key,
         e.value ->> 'value_text', (e.value ->> 'value_number')::numeric, (e.value ->> 'value_date')::date,
         e.value -> 'value_json'
  from jsonb_each(v_rows) e
  where answer_has_value(e.value);

  -- Attach files, then derive file answers from every attached file.
  update response_files rf
     set status = 'attached', response_id = r.id, attached_at = coalesce(rf.attached_at, now()),
         size_bytes = (o.metadata ->> 'size')::bigint, mime_type = o.metadata ->> 'mimetype'
    from storage.objects o
   where rf.id = any (v_file_ids) and o.bucket_id = 'response-files' and o.name = rf.object_path;
  delete from answers a using response_files rf
   where a.response_id = r.id and rf.response_id = r.id and a.question_key = rf.question_key;
  insert into answers (response_id, workspace_id, survey_id, survey_version_id, question_key, value_json)
  select r.id, s.workspace_id, s.id, v.id, rf.question_key,
         case when max(q2.type) = 'signature'
              then (jsonb_agg(jsonb_build_object('file_id', rf.id, 'path', rf.object_path, 'name', rf.original_name,
                                                 'size', rf.size_bytes, 'mime', rf.mime_type) order by rf.created_at desc)) -> 0
              else jsonb_agg(jsonb_build_object('file_id', rf.id, 'path', rf.object_path, 'name', rf.original_name,
                                                'size', rf.size_bytes, 'mime', rf.mime_type) order by rf.created_at) end
  from response_files rf
  join questions q2 on q2.survey_version_id = v.id and q2.question_key = rf.question_key
  where rf.response_id = r.id
  group by rf.question_key;

  if (p_payload ->> 'last_question_key') is not null
     and exists (select 1 from questions where survey_version_id = v.id and question_key = p_payload ->> 'last_question_key') then
    update responses set last_question_key = p_payload ->> 'last_question_key' where id = r.id;
  end if;

  if p_action = 'save' then
    if nullif(p_payload ->> 'resume_token_hash', '') is null then
      v_secret := gen_token(32);
      update responses set resume_token_hash = sha256_hex(v_secret) where id = r.id;
    end if;
    perform set_config('survey.internal', 'off', true);
    return jsonb_strip_nulls(jsonb_build_object('ok', true, 'response_id', r.id, 'resume_token', v_secret));
  end if;

  -- ---- complete: contact resolution (docs/04 section 2.1) ----
  v_email := v_rows -> coalesce(s.identity_question_key,
               v.definition -> 'questions' -> (v.definition #>> '{identity,email_question_id}') ->> 'question_key') ->> 'value_text';
  v_phone := v_rows -> coalesce(s.identity_phone_key,
               v.definition -> 'questions' -> (v.definition #>> '{identity,phone_question_id}') ->> 'question_key') ->> 'value_text';
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;
  if tok.id is not null then
    v_contact := follow_contact(tok.contact_id);
    if v_contact is not null then
      v_source := 'token';
      if v_email is not null and v_email is distinct from (select email from contacts where id = v_contact) then
        v_meta := v_meta || jsonb_build_object('alt_email', v_email);
      end if;
    end if;
  end if;
  if v_contact is null and v_email is not null then
    v_contact := find_or_create_contact_by_email(s.workspace_id, v_email, 'survey:' || s.id);
    v_source := 'identity_answer';
  end if;
  if v_contact is null and v_email is null and v_phone is not null then
    select count(*) into v_n from contacts
     where workspace_id = s.workspace_id and phone = v_phone and merged_into is null and status = 'active';
    if v_n = 1 then
      select id into v_contact from contacts
       where workspace_id = s.workspace_id and phone = v_phone and merged_into is null and status = 'active';
    elsif v_n = 0 then
      insert into contacts (workspace_id, phone, source) values (s.workspace_id, v_phone, 'survey:' || s.id)
      returning id into v_contact;
    end if;
    if v_contact is not null then v_source := 'identity_answer'; end if;
  end if;
  if v_contact is null and s.trust_hidden_identity then
    v_hidden := coalesce(r.metadata -> 'hidden', '{}'::jsonb);
    if (v_hidden ->> 'contact') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_contact := follow_contact(coalesce(
        (select id from contacts where id = (v_hidden ->> 'contact')::uuid and workspace_id = s.workspace_id),
        (select contact_id from contact_aliases where alias_id = (v_hidden ->> 'contact')::uuid and workspace_id = s.workspace_id)));
    end if;
    if v_contact is null and lower(btrim(v_hidden ->> 'email')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_contact := find_or_create_contact_by_email(s.workspace_id, lower(btrim(v_hidden ->> 'email')), 'survey:' || s.id);
    end if;
    if v_contact is not null then v_source := 'hidden_field'; end if;
  end if;

  if v_contact is not null then
    -- Question to contact mapping fills blank fields only.
    for q in select qq.question_key, qq.type, qq.config -> 'contact_field' as cf from questions qq
              where qq.survey_version_id = v.id and qq.config ? 'contact_field' loop
      v_row := v_rows -> q.question_key;
      continue when not answer_has_value(v_row);
      if q.cf ->> 'kind' = 'core' and q.cf ->> 'field' in ('first_name', 'last_name', 'company', 'phone') then
        update contacts set
          first_name = case when q.cf ->> 'field' = 'first_name' then coalesce(first_name, v_row ->> 'value_text') else first_name end,
          last_name  = case when q.cf ->> 'field' = 'last_name'  then coalesce(last_name,  v_row ->> 'value_text') else last_name end,
          company    = case when q.cf ->> 'field' = 'company'    then coalesce(company,    v_row ->> 'value_text') else company end,
          phone      = case when q.cf ->> 'field' = 'phone'      then coalesce(phone,      v_row ->> 'value_text') else phone end
        where id = v_contact;
      elsif q.cf ->> 'kind' = 'custom' and q.cf ->> 'key' is not null then
        select custom into v_custom from contacts where id = v_contact;
        if not (v_custom ? (q.cf ->> 'key')) then
          begin
            v_custom := validate_contact_custom(s.workspace_id, jsonb_build_object(q.cf ->> 'key',
              coalesce(v_row -> 'value_text', v_row -> 'value_number', to_jsonb(v_row ->> 'value_date'),
                       case when q.type = 'multiple_choice' then multi_choice_ids(v_row -> 'value_json') else v_row -> 'value_json' end)));
            update contacts set custom = custom || v_custom where id = v_contact;
          exception when others then
            null;   -- incompatible value: the answer stays on the response only
          end;
        end if;
      end if;
    end loop;
    update contacts set response_count = response_count + 1, last_response_at = now() where id = v_contact;
  end if;

  -- Score from the server half of the definition (R9). A quiz score calc
  -- computed by the route's validator wins; option, yes/no and matrix column
  -- scores are summed here otherwise. score_max is the best possible sum.
  for q in select qq.type, qq.question_key, qq.config -> 'settings' as st2 from questions qq where qq.survey_version_id = v.id loop
    v_row := v_rows -> q.question_key;
    if q.type in ('single_choice', 'dropdown', 'multiple_choice', 'ranking')
       and exists (select 1 from jsonb_array_elements(coalesce(q.st2 -> 'options', '[]')) o where o ? 'score') then
      v_scored := true;
      if q.type = 'multiple_choice' then
        v_max := v_max + coalesce((select sum(greatest((o ->> 'score')::numeric, 0)) from jsonb_array_elements(q.st2 -> 'options') o), 0);
        v_score := v_score + coalesce((select sum((o ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'options') o
                                       where (o ->> 'id') in (select jsonb_array_elements_text(multi_choice_ids(v_row -> 'value_json')))), 0);
      elsif q.type in ('single_choice', 'dropdown') then
        v_max := v_max + coalesce((select max((o ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'options') o), 0);
        v_score := v_score + coalesce((select (o ->> 'score')::numeric from jsonb_array_elements(q.st2 -> 'options') o
                                       where o ->> 'id' = v_row ->> 'value_text' limit 1), 0);
      end if;
    elsif q.type = 'yes_no' and (q.st2 ? 'yes_score' or q.st2 ? 'no_score') then
      v_scored := true;
      v_max := v_max + greatest(coalesce((q.st2 ->> 'yes_score')::numeric, 0), coalesce((q.st2 ->> 'no_score')::numeric, 0));
      v_score := v_score + coalesce(case (v_row ->> 'value_number')::numeric
                                      when 1 then (q.st2 ->> 'yes_score')::numeric
                                      when 0 then (q.st2 ->> 'no_score')::numeric end, 0);
    elsif q.type = 'matrix'
          and exists (select 1 from jsonb_array_elements(coalesce(q.st2 -> 'columns', '[]')) c where c ? 'score') then
      v_scored := true;
      v_max := v_max + jsonb_array_length(coalesce(q.st2 -> 'rows', '[]'))
                       * coalesce((select max((c ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'columns') c), 0);
      v_score := v_score + coalesce((select sum((c ->> 'score')::numeric)
                                     from jsonb_each(coalesce(v_row -> 'value_json', '{}')) a
                                     join jsonb_array_elements(q.st2 -> 'columns') c on c ->> 'id' = a.value #>> '{}'), 0);
    end if;
  end loop;
  v_quizkey := v.definition -> 'questions' -> (v.definition #>> '{settings,quiz,score_calc_id}') ->> 'question_key';
  if v_quizkey is not null and (v_rows -> v_quizkey) ? 'value_number' then
    v_score := (v_rows -> v_quizkey ->> 'value_number')::numeric;
    v_scored := true;
  end if;

  if w.store_ip and nullif(p_payload ->> 'ip', '') is not null then
    begin
      v_ip := (p_payload ->> 'ip')::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  update responses set
    status = 'complete', submitted_at = now(), contact_id = v_contact, identity_source = v_source,
    score = case when v_scored then v_score end, score_max = case when v_scored then v_max end,
    metadata = metadata || v_meta,
    raw = p_payload - 'ip' - 'resume_token_hash' - 'respondent_token',
    ip = v_ip, resume_token_hash = null
  where id = r.id;

  if tok.id is not null then
    update respondent_tokens set used_count = used_count + 1 where id = tok.id;
  end if;

  if v_rid is not null then
    update events set response_id = r.id where survey_id = s.id and respondent_hash = v_rid and response_id is null;
  end if;
  insert into events (workspace_id, survey_id, survey_version_id, response_id, respondent_hash, type)
  values (s.workspace_id, s.id, v.id, r.id, v_rid, 'complete');

  perform set_config('survey.internal', 'off', true);
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'response_id', r.id,
    'score', case when v_scored then v_score end, 'score_max', case when v_scored then v_max end));
end $$;

-- ===========================================================================
-- L-3 and D-12. Share password hashes are bcrypt from hash_share_password
-- ===========================================================================
-- The app gets a hash from hash_share_password() (bcrypt) and writes it; any
-- other format (MD5-crypt "$1$", plain text) is refused on write. Existing
-- rows are left alone so current share passwords keep working; they move to
-- bcrypt the next time the password changes.
create or replace function guard_report_share_password() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.password_hash is not null
     and (tg_op = 'INSERT' or new.password_hash is distinct from old.password_hash)
     and new.password_hash !~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'Share passwords must be hashed with hash_share_password()';
  end if;
  return new;
end $$;
drop trigger if exists report_shares_password_guard on report_shares;
create trigger report_shares_password_guard before insert or update on report_shares
  for each row execute function guard_report_share_password();

-- ===========================================================================
-- L-6. contact_imports.storage_path stays under the workspace prefix
-- ===========================================================================
-- NOT VALID: enforced for every new or changed row; rows written before this
-- migration are not rechecked (none exist outside test data).
-- The check runs as the inserting member, so the pure helper is executable.
grant execute on function storage_object_name(text, text) to authenticated, service_role;
alter table contact_imports drop constraint if exists contact_imports_path_scoped;
alter table contact_imports add constraint contact_imports_path_scoped check (
  storage_path is null
  or (storage_object_name('imports', storage_path) like workspace_id::text || '/%'
      and storage_path !~ '\.\.')) not valid;

-- ===========================================================================
-- L-8 and D-13. Realtime publishes insert and update only
-- ===========================================================================
-- Postgres Changes cannot apply RLS to DELETE events, so a subscriber in any
-- workspace would see deleted response ids. responses is the only table in
-- the publication; the setting is publication wide.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish = 'insert, update');
  end if;
end $$;

-- ===========================================================================
-- L-9. Rate limit rows live as long as the longest window
-- ===========================================================================
-- rate_limit_hit accepts windows up to 1 day, so rows are pruned after 1 day
-- (was 2 hours). The IP key is HMAC(ip, secret + UTC date): counters reset at
-- 00:00 UTC by design, which bounds how long a hashed IP is linkable and is
-- accepted (at most twice a limit across midnight).
select cron.schedule('prune_rate_limits', '*/15 * * * *',
  $$delete from public.rate_limit_events where at < now() - interval '1 day'$$);

-- ===========================================================================
-- L-12. Salted email hash in the erasure log
-- ===========================================================================
-- One random salt, generated once, in a table nobody but definer functions
-- can read (RLS on, no policies, no grants). Old erasure rows lose their
-- unsalted hash; it cannot be recomputed without the address.
create table if not exists internal_secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table internal_secrets enable row level security;
revoke all on internal_secrets from public, anon, authenticated, service_role;
insert into internal_secrets (name, value) values ('erasure_email_salt', gen_token(32))
on conflict (name) do nothing;

create or replace function erasure_email_hash(p_email text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select sha256_hex((select value from internal_secrets where name = 'erasure_email_salt')
                    || ':' || lower(btrim(p_email)))
  where nullif(btrim(p_email), '') is not null;
$$;
revoke all on function erasure_email_hash(text) from public, anon, authenticated;

update activity_log set diff = diff - 'email_sha256'
 where entity = 'contact' and action = 'erase' and diff ? 'email_sha256';

-- ===========================================================================
-- L-13. Response deletion goes through delete_response()
-- ===========================================================================
-- The direct delete policy is gone. The function needs admin of the
-- response's workspace, writes an activity row, decrements
-- surveys.complete_count for a complete response, recounts the contact's
-- response_count, and enqueues files with reason 'erase'.
drop policy if exists responses_delete on responses;

create or replace function delete_response(p_response_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r responses;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_response_id is null then
    raise exception 'not_found';
  end if;
  select * into r from responses where id = p_response_id;
  if r.id is null or not is_member(r.workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  perform 1 from surveys where id = r.survey_id for update;   -- same lock order as submit_response_core
  select * into r from responses where id = p_response_id for update;
  if r.id is null then
    raise exception 'not_found';
  end if;

  perform set_config('survey.internal', 'on', true);
  perform set_config('survey.deletion_reason', 'erase', true);
  delete from responses where id = r.id;   -- answers and file rows cascade, files enqueue
  if r.status = 'complete' then
    update surveys set complete_count = greatest(complete_count - 1, 0) where id = r.survey_id;
    if r.contact_id is not null then
      update contacts c
         set response_count = (select count(*) from responses x where x.contact_id = c.id and x.status = 'complete')
       where c.id = r.contact_id;
    end if;
  end if;
  perform set_config('survey.deletion_reason', '', true);
  perform set_config('survey.internal', 'off', true);

  perform write_activity(r.workspace_id, 'response', r.id, 'delete', jsonb_build_object(
    'survey_id', r.survey_id, 'status', r.status, 'submitted_at', r.submitted_at));
end $$;
revoke all on function delete_response(uuid) from public, anon;
grant execute on function delete_response(uuid) to authenticated;

-- ===========================================================================
-- L-10 and I6 and L-12: function bodies follow.
-- ===========================================================================

-- L-10. take_draft_lock from 0005; the stale takeover bumps revision too
-- (the forced takeover already did).
create or replace function take_draft_lock(p_version_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v      survey_versions;
  v_prev uuid;
begin
  select * into v from survey_versions where id = p_version_id for update;
  if v.id is null or not is_member(v.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if v.status <> 'draft' then
    raise exception 'not_draft';
  end if;
  if v.locked_by is null or v.locked_by = v_uid or v.locked_at < now() - interval '15 minutes' then
    -- L-10: taking over another editor's stale lock bumps the revision, so a
    -- save still in flight from the previous holder fails with revision_conflict.
    v_prev := case when v.locked_by is not null and v.locked_by <> v_uid then v.locked_by end;
    update survey_versions
       set locked_by = v_uid, locked_at = now(),
           revision = revision + case when v_prev is not null then 1 else 0 end
     where id = p_version_id
    returning * into v;
  elsif coalesce(p_force, false) then
    v_prev := v.locked_by;
    update survey_versions set locked_by = v_uid, locked_at = now(), revision = revision + 1
     where id = p_version_id returning * into v;
    perform write_activity(v.workspace_id, 'survey', v.survey_id, 'lock_takeover',
      jsonb_build_object('version_id', p_version_id, 'previous', v_prev, 'new', v_uid));
  else
    return jsonb_build_object('ok', false, 'locked_by', v.locked_by, 'locked_at', v.locked_at, 'revision', v.revision);
  end if;
  return jsonb_build_object('ok', true, 'locked_by', v.locked_by, 'locked_at', v.locked_at, 'revision', v.revision);
end $$;

-- L-10. save_draft from 0005; reads the version under a row lock.
create or replace function save_draft(p_version_id uuid, p_expected_revision int, p_definition jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v     survey_versions;
  l     record;
  v_rev int;
begin
  -- L-10: row lock before the lock and revision checks.
  select * into v from survey_versions where id = p_version_id for update;
  if v.id is null or not is_member(v.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if v.status <> 'draft' then
    raise exception 'not_draft';
  end if;
  if v.locked_by is distinct from v_uid or v.locked_at < now() - interval '15 minutes' then
    raise exception 'lock_lost';
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object'
     or jsonb_typeof(p_definition -> 'pages') is distinct from 'array' then
    raise exception 'invalid_definition';
  end if;
  select * into l from effective_limits(v.workspace_id);
  if octet_length(p_definition::text) > l.max_definition_bytes then
    raise exception 'definition_too_large';
  end if;
  if definition_question_count(p_definition) > l.max_questions then
    raise exception 'too_many_questions';
  end if;

  update survey_versions
     set definition = p_definition, revision = revision + 1, locked_at = now()
   where id = p_version_id and revision = p_expected_revision and status = 'draft'
  returning revision into v_rev;
  if v_rev is null then
    raise exception 'revision_conflict';
  end if;

  -- Coalesced draft edit log: at most one row per editor per survey per 10 minutes.
  if not exists (select 1 from activity_log
                 where workspace_id = v.workspace_id and entity = 'survey' and entity_id = v.survey_id
                   and action = 'draft_edited' and actor = v_uid
                   and created_at > now() - interval '10 minutes') then
    perform write_activity(v.workspace_id, 'survey', v.survey_id, 'draft_edited',
                           jsonb_build_object('version_id', p_version_id));
  end if;
  return v_rev;
end $$;

-- I6. report_widget_data from 0018; min and max are suppressed on shared
-- reports when fewer than 3 answers hold that value.
create or replace function report_widget_data(p_survey_id uuid, p_filters jsonb, p_question_key text, p_metric text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  q      questions;
  v_type text;
  v_n    int;
  v_out  jsonb;
begin
  if p_question_key is null then
    -- funnel metric over the latest published version (event counts only)
    select jsonb_build_object(
             'views',     count(distinct e.respondent_hash) filter (where e.type = 'view'),
             'starts',    count(distinct e.respondent_hash) filter (where e.type = 'start'),
             'completes', count(*) filter (where e.type = 'complete'))
      into v_out
      from events e join surveys s on s.id = e.survey_id
     where e.survey_id = p_survey_id and e.survey_version_id = s.latest_published_version_id;
    return jsonb_build_object('metric', p_metric, 'funnel', v_out);
  end if;

  select qq.* into q from questions qq join surveys s on s.id = qq.survey_id
   where qq.survey_id = p_survey_id and qq.question_key = p_question_key
   order by (qq.survey_version_id = s.latest_published_version_id) desc, qq.position
   limit 1;
  v_type := q.type;
  create temporary table if not exists pg_temp.rw_answers (value_text text, value_number numeric, value_json jsonb) on commit drop;
  truncate pg_temp.rw_answers;
  insert into pg_temp.rw_answers
  select a.value_text, a.value_number, a.value_json
  from answers a join filtered_responses(p_survey_id, p_filters) r on r.id = a.response_id
  where a.question_key = p_question_key;
  select count(*) into v_n from pg_temp.rw_answers;

  if v_type in ('single_choice', 'dropdown') then
    select coalesce(jsonb_agg(jsonb_build_object('option_id', k, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3) order by n desc), '[]') into v_out
      from (select value_text as k, count(*) as n from pg_temp.rw_answers group by value_text) t;
  elsif v_type in ('multiple_choice', 'ranking') then
    select coalesce(jsonb_agg(jsonb_build_object('option_id', k, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3,
                                                 'avg_position', case when v_type = 'ranking' and n >= 3 then avg_pos end)
                              order by n desc), '[]') into v_out
      from (select e.value as k, count(*) as n, round(avg(e.ordinality), 2) as avg_pos
              from pg_temp.rw_answers a, jsonb_array_elements_text(multi_choice_ids(a.value_json)) with ordinality e
             group by e.value) t;
  elsif v_type = 'matrix' then
    select coalesce(jsonb_agg(jsonb_build_object('row_id', rk, 'column_id', ck, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3)), '[]') into v_out
      from (select e.key as rk, e.value #>> '{}' as ck, count(*) as n
              from pg_temp.rw_answers a, jsonb_each(a.value_json) e group by 1, 2) t;
  elsif v_type in ('number', 'rating', 'nps', 'yes_no', 'consent', 'calculated') then
    if v_n < 3 then
      v_out := jsonb_build_object('suppressed', true);
    else
      select jsonb_build_object(
               'mean', round(avg(value_number), 2),
               'median', percentile_cont(0.5) within group (order by value_number),
               -- I6: on a shared report the extremes are single respondents' values;
               -- show them only when at least 3 answers share the value.
               'min', case when not flag_on('survey.shared_report')
                             or (select count(*) from pg_temp.rw_answers x
                                  where x.value_number = (select min(y.value_number) from pg_temp.rw_answers y)) >= 3
                           then min(value_number) end,
               'max', case when not flag_on('survey.shared_report')
                             or (select count(*) from pg_temp.rw_answers x
                                  where x.value_number = (select max(y.value_number) from pg_temp.rw_answers y)) >= 3
                           then max(value_number) end,
               'distribution', case when v_type in ('rating', 'nps', 'yes_no', 'consent') then (
                  select jsonb_agg(jsonb_build_object('value', x, 'count', case when c >= 3 then c end, 'suppressed', c < 3) order by x)
                  from (select value_number as x, count(*) as c from pg_temp.rw_answers group by value_number) d) end,
               'nps', case when v_type = 'nps' then round(100.0 * (count(*) filter (where value_number >= 9)
                                                         - count(*) filter (where value_number <= 6)) / nullif(count(*), 0)) end)
        into v_out from pg_temp.rw_answers where value_number is not null;
    end if;
  elsif v_type in ('short_text', 'long_text') then
    select coalesce(jsonb_agg(jsonb_build_object('word', wd, 'count', n) order by n desc, wd), '[]') into v_out
      from (select wd, count(*) as n
              from pg_temp.rw_answers a, regexp_split_to_table(lower(a.value_text), '[^[:alnum:]'']+') wd
             where length(wd) > 2 and wd not in (select word from stopwords where lang = 'en')
             group by wd having count(*) >= 3 order by n desc limit 50) t;
  else
    v_out := null;   -- identity, contact, file and free-form types: count only
  end if;
  return jsonb_build_object('n', case when v_n >= 3 then v_n end, 'suppressed', v_n < 3, 'type', v_type, 'data', v_out);
end $$;

-- I6. shared_report_payload from 0018; raises survey.shared_report around the
-- widget calls.
create or replace function shared_report_payload(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sh  report_shares;
  rep reports;
  s   surveys;
  w   workspaces;
  v_widgets jsonb;
begin
  if p_token is null or length(p_token) not between 8 and 100 then
    return null;
  end if;
  select * into sh from report_shares where token = p_token;
  if sh.id is null or sh.revoked_at is not null or (sh.expires_at is not null and sh.expires_at <= now()) then
    return null;
  end if;
  if sh.password_hash is not null
     and (p_password is null or extensions.crypt(p_password, sh.password_hash) <> sh.password_hash) then
    return null;
  end if;
  select * into rep from reports where id = sh.report_id;
  select * into s from surveys where id = rep.survey_id;
  select * into w from workspaces where id = s.workspace_id;
  if w.deleted_at is not null or s.workspace_id <> sh.workspace_id then
    return null;
  end if;

  perform set_config('survey.shared_report', 'on', true);   -- I6
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rw.id, 'position', rw.position, 'chart_type', rw.chart_type,
           'question_key', rw.question_key, 'metric', rw.metric,
           'label', q.label,
           'options', snapshot_labels(q.options),
           'rows', case when q.type = 'matrix' then snapshot_labels(q.config #> '{settings,rows}') end,
           'columns', case when q.type = 'matrix' then snapshot_labels(q.config #> '{settings,columns}') end,
           'result', report_widget_data(s.id, rep.filters, rw.question_key, rw.metric))
         order by rw.position), '[]')
    into v_widgets
    from report_widgets rw
    left join questions q on q.survey_version_id = s.latest_published_version_id and q.question_key = rw.question_key
   where rw.report_id = rep.id;
  perform set_config('survey.shared_report', 'off', true);

  return jsonb_build_object(
    'report', jsonb_build_object('name', rep.name),
    'survey', jsonb_build_object('title', s.title),
    'workspace', jsonb_build_object('name', w.name, 'logo_path', w.logo_path),
    'widgets', v_widgets);
end $$;

-- L-12. erase_respondent from 0018; the log keeps a salted email hash.
create or replace function erase_respondent(p_contact_id uuid, p_mode text)
returns table (deletion_id bigint, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      uuid;
  c         contacts;
  v_all     uuid[];
  v_resp    uuid[];
  v_files   int;
  v_answers int := 0;
  v_keep    text[] := array['single_choice','dropdown','multiple_choice','yes_no','rating','nps','matrix',
                            'ranking','date','number','consent','calculated','time'];
begin
  if p_mode is null or p_mode not in ('hard', 'anonymize') then
    raise exception 'invalid_mode';
  end if;
  v_id := coalesce((select a.contact_id from contact_aliases a where a.alias_id = p_contact_id), p_contact_id);
  for i in 1..10 loop
    select * into c from contacts where id = v_id;
    exit when c.id is null or c.merged_into is null;
    v_id := c.merged_into;
  end loop;
  if c.id is null or not is_member(c.workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  v_all := contact_family(c.id);
  v_resp := array(select r.id from responses r where r.contact_id = any (v_all));
  select count(*) into v_files from response_files f where f.response_id = any (v_resp);

  perform set_config('survey.internal', 'on', true);
  perform set_config('survey.skip_log', 'on', true);
  perform set_config('survey.deletion_reason', 'erase', true);

  if p_mode = 'hard' then
    delete from events e where e.response_id = any (v_resp);
    delete from responses r where r.id = any (v_resp);      -- answers and file rows cascade, files enqueue
    delete from respondent_tokens t where t.contact_id = any (v_all);
    delete from contact_aliases a where a.contact_id = any (v_all) or a.alias_id = any (v_all);
    delete from contact_notes n where n.contact_id = any (v_all);
    delete from contacts x where x.id = any (v_all);
  else
    delete from response_files f where f.response_id = any (v_resp);
    with del as (
      delete from answers a
       using responses r, surveys s, questions q
       where a.response_id = r.id and r.id = any (v_resp) and s.id = r.survey_id
         and q.survey_version_id = r.survey_version_id and q.question_key = a.question_key
         and (not (q.type = any (v_keep)) or q.is_pii or q.config ? 'contact_field'
              or a.question_key = s.identity_question_key or a.question_key = s.identity_phone_key)
      returning 1)
    select count(*) into v_answers from del;
    -- answers whose question is missing from the snapshot are dropped too
    delete from answers a where a.response_id = any (v_resp)
       and not exists (select 1 from questions q join responses r on r.id = a.response_id
                       where q.survey_version_id = r.survey_version_id and q.question_key = a.question_key);
    -- "Other" free text on kept choice answers is open text: drop it, keep the ids.
    update answers a
       set value_json = case when jsonb_typeof(a.value_json -> 'ids') = 'array' then a.value_json -> 'ids' end
      from responses r, questions q
     where a.response_id = r.id and r.id = any (v_resp)
       and q.survey_version_id = r.survey_version_id and q.question_key = a.question_key
       and q.type in ('single_choice', 'dropdown', 'multiple_choice')
       and jsonb_typeof(a.value_json) = 'object' and a.value_json ? 'other';
    update responses r set
      ip = null, respondent_hash = null, resume_token_hash = null, anonymized_at = now(),
      metadata = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(r.metadata) e
                   where e.key in ('device', 'pixel_consent') or e.key like 'utm\_%'),
      raw = jsonb_build_object('redacted', true, 'answers',
              (select coalesce(jsonb_object_agg(a.question_key, jsonb_strip_nulls(jsonb_build_object(
                         'value_text', a.value_text, 'value_number', a.value_number,
                         'value_date', a.value_date, 'value_json', a.value_json))), '{}'::jsonb)
                 from answers a where a.response_id = r.id))
    where r.id = any (v_resp);
    update events e set response_id = null, respondent_hash = null where e.response_id = any (v_resp);
    delete from contact_notes n where n.contact_id = any (v_all);
    delete from contact_aliases a where a.contact_id = any (v_all) or a.alias_id = any (v_all);
    delete from respondent_tokens t where t.contact_id = any (v_all);
    update contacts x set
      status = 'deleted', deleted_at = now(), email = null, phone = null, first_name = null, last_name = null,
      company = null, tags = '{}', custom = '{}', lead_status = 'lost', owner_id = null,
      follow_up_at = null, follow_up_note = null
    where x.id = any (v_all);
  end if;

  update activity_log l set diff = '{"redacted": true}'::jsonb
   where l.entity = 'contact' and l.entity_id = any (v_all);

  perform set_config('survey.deletion_reason', '', true);
  perform set_config('survey.skip_log', 'off', true);
  perform set_config('survey.internal', 'off', true);

  perform write_activity(c.workspace_id, 'contact', c.id, 'erase', jsonb_build_object(
    'mode', p_mode, 'responses', cardinality(v_resp), 'files', v_files, 'answers_deleted', v_answers,
    -- L-12: salted hash; an unsalted sha256 of an email is reversible by dictionary.
    'email_hash', case when c.email is not null then erasure_email_hash(c.email) end));

  return query
    select d.id, d.bucket, d.path from storage_deletions d
     where d.workspace_id = c.workspace_id and d.reason = 'erase' and d.enqueued_at = now() and d.done_at is null;
end $$;

-- ===========================================================================
-- Grants for the replaced functions (create or replace keeps existing grants;
-- restated so the list is the whole story) and the anon invariant from 0017.
-- ===========================================================================
revoke all on function apply_invites(uuid, text, text, text) from public, anon, authenticated;
revoke all on function submit_response_core(jsonb, text) from public, anon, authenticated;
revoke all on function report_widget_data(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function effective_limits(uuid) to authenticated, service_role;
grant execute on function create_upload(jsonb), submit_response(jsonb) to service_role;
grant execute on function shared_report_payload(text, text) to service_role;
grant execute on function take_draft_lock(uuid, boolean), save_draft(uuid, int, jsonb) to authenticated;
grant execute on function erase_respondent(uuid, text) to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function resolve_public_survey(text)       to anon, authenticated, service_role;
grant execute on function get_public_definition(uuid, text) to anon;
