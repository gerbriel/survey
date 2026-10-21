-- 0004: signup trigger and invite claiming. Spec: docs/01-data-model.md
-- section 12, docs/05-workspaces-and-admin.md section 3. Pattern from Fresno
-- Skillshare migrations 00001, 00012, 00017.
--
-- A profile activates when any of these is valid: an open platform_invites row
-- whose email matches; a platform_invites token (/invite/{token}); a
-- workspace_invites token (/join/{token}). All claim paths share apply_invites.

-- Internal. Returns {status, workspace_id} where status is one of
--   'joined'          workspace invite accepted, membership created
--   'already_member'  workspace invite valid but caller is already a member (role unchanged)
--   'activated'       profile went from pending to active through a platform invite
--   'active'          nothing to claim, profile already active
--   'pending'         nothing valid to claim, profile still pending
--   'invalid'         a token was given but is unknown, expired, revoked or exhausted
--   'disabled'        the profile is disabled or deleted; nothing applied
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

-- After insert on auth.users: create the profile (name and avatar from OAuth
-- metadata, Fresno 00017 style), then claim invites. Email/password signup
-- passes tokens in options.data as workspace_invite_token / platform_invite_token.
-- A failure to claim never blocks the signup itself.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
begin
  v_name := left(coalesce(nullif(btrim(v_meta ->> 'full_name'), ''),
                          nullif(btrim(v_meta ->> 'name'), ''),
                          nullif(btrim(v_meta ->> 'display_name'), ''),
                          nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                          'New user'), 80);
  insert into profiles (id, display_name, avatar_url)
  values (new.id, v_name, nullif(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'), ''))
  on conflict (id) do nothing;
  begin
    perform apply_invites(new.id, new.email, v_meta ->> 'workspace_invite_token', v_meta ->> 'platform_invite_token');
  exception when others then
    raise warning 'handle_new_user: invite claim failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- "Check again" on /pending and every sign-in: email match only (Fresno 00012).
create or replace function claim_pending_invite() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  return apply_invites(v_uid, (select email from auth.users where id = v_uid), null, null);
end $$;

-- /invite/{token}, called by the auth callback with the token from an HttpOnly cookie.
create or replace function claim_platform_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or length(btrim(p_token)) not between 8 and 200 then
    return jsonb_build_object('status', 'invalid', 'workspace_id', null);
  end if;
  return apply_invites(v_uid, (select email from auth.users where id = v_uid), null, p_token);
end $$;

-- /join/{token}
create or replace function accept_workspace_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or length(btrim(p_token)) not between 8 and 200 then
    return jsonb_build_object('status', 'invalid', 'workspace_id', null);
  end if;
  return apply_invites(v_uid, (select email from auth.users where id = v_uid), p_token, null);
end $$;

grant execute on function claim_pending_invite(), claim_platform_invite(text), accept_workspace_invite(text)
  to authenticated;
