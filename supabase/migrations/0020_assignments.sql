-- 0020: survey assignment (R19) and direct membership assignment (R20).
-- Rulings R19 and R20 in docs/00-decisions.md; function list in
-- docs/01-data-model.md section 12, "Assignments (R19, R20)".
--
--   R19  survey_assignments (one owner, any number of collaborators), the
--        creator becomes owner, set_survey_owner, add_survey_collaborator,
--        remove_survey_collaborator, member removal drops collaborator rows
--        and reassigns owned surveys, member_owned_survey_counts
--   R20  directory_profiles, add_workspace_member, admin_add_workspace_member,
--        admin_remove_workspace_member, admin_set_member_role
--
-- Same discipline as 0018 and 0019: SECURITY DEFINER with search_path =
-- public, pg_temp, input checks, explicit grants, RLS with WITH CHECK where a
-- client may write (here: nowhere; every write goes through a function).
-- Assignment is responsibility metadata, not authorization (R19): who may see
-- or edit a survey is still decided by workspace role.
--
-- Existing data: the backfill near the end makes each existing survey's
-- creator its owner when the creator is still an active member. Surveys
-- whose creator left stay unassigned. It inserts rows only; nothing is
-- updated or deleted.

-- ===========================================================================
-- R19. Table
-- ===========================================================================
-- Primary key (survey_id, user_id): a person is the owner or a collaborator
-- of a survey, never both.
create table survey_assignments (
  survey_id    uuid not null references surveys(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,  -- copied from the survey by the guard
  user_id      uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('owner', 'collaborator')),
  assigned_by  uuid references profiles(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (survey_id, user_id)
);
-- R19: exactly one owner per survey.
create unique index survey_one_owner on survey_assignments (survey_id) where kind = 'owner';
create index survey_assignments_member on survey_assignments (workspace_id, user_id);

-- True when p_user is an active profile and a member of p_workspace_id.
create or replace function is_active_member(p_workspace_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from workspace_members m join profiles p on p.id = m.user_id
                 where m.workspace_id = p_workspace_id and m.user_id = p_user and p.status = 'active');
$$;
revoke all on function is_active_member(uuid, uuid) from public, anon, authenticated;

-- R19 guard. Only the functions below write (flag survey.assign); clients
-- hold no write grant either. workspace_id always comes from the survey, so a
-- row can never point at another workspace. A new row, and any row becoming
-- the owner, needs an active member of the survey's workspace.
create or replace function guard_survey_assignment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (is_trusted_caller() or flag_on('survey.assign')) then
    raise exception 'Survey assignments change only through set_survey_owner, add_survey_collaborator and remove_survey_collaborator';
  end if;
  if tg_op = 'UPDATE' and (new.survey_id <> old.survey_id or new.user_id <> old.user_id) then
    raise exception 'survey_id and user_id are immutable on an assignment';
  end if;
  select s.workspace_id into new.workspace_id from surveys s where s.id = new.survey_id;
  if new.workspace_id is null then
    raise exception 'not_found';
  end if;
  if (tg_op = 'INSERT' or new.kind = 'owner') and not is_active_member(new.workspace_id, new.user_id) then
    raise exception 'assignee_not_member';
  end if;
  return new;
end $$;
create trigger survey_assignments_guard before insert or update on survey_assignments
  for each row execute function guard_survey_assignment();

alter table survey_assignments enable row level security;
-- R19: members read. No insert, update or delete policy: writes only through
-- the functions below, which run as the table owner.
create policy survey_assignments_select on survey_assignments for select to authenticated
  using (is_member(workspace_id));
revoke all on survey_assignments from public, anon, authenticated;
grant select on survey_assignments to authenticated;
grant all on survey_assignments to service_role;

-- ===========================================================================
-- R19. The creator becomes the owner (create_survey keeps its signature;
-- an after insert trigger covers it and any later insert path).
-- ===========================================================================
create or replace function assign_survey_creator() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('survey.assign', true), '');
begin
  if new.created_by is null or not is_active_member(new.workspace_id, new.created_by) then
    return null;   -- Decision: no owner when the creator is unknown or not an active member
  end if;
  perform set_config('survey.assign', 'on', true);
  insert into survey_assignments (survey_id, workspace_id, user_id, kind, assigned_by)
  values (new.id, new.workspace_id, new.created_by, 'owner', new.created_by)
  on conflict do nothing;
  perform set_config('survey.assign', v_prev, true);
  return null;
end $$;
revoke all on function assign_survey_creator() from public, anon, authenticated;
create trigger surveys_assign_creator after insert on surveys
  for each row execute function assign_survey_creator();

-- ===========================================================================
-- R19. Assignment functions. Editor and above (is_member, so an archived
-- workspace is read only). Each writes activity_log on entity 'survey'.
-- ===========================================================================

-- Internal: the survey's workspace, locked, after the editor check.
create or replace function survey_for_assignment(p_survey_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from surveys where id = p_survey_id for update;
  if v_ws is null or not is_member(v_ws, 'editor') then
    raise exception 'not_authorized';
  end if;
  return v_ws;
end $$;
revoke all on function survey_for_assignment(uuid) from public, anon, authenticated;

-- Decision: the previous owner stays on the survey as a collaborator (when
-- still an active member), so handing a survey over never silently drops
-- someone; they can be removed with one more click.
create or replace function set_survey_owner(p_survey_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws   uuid := survey_for_assignment(p_survey_id);
  v_old  uuid;
  v_prev text := coalesce(current_setting('survey.assign', true), '');
begin
  if p_user_id is null then
    raise exception 'invalid_target';
  end if;
  if not is_active_member(v_ws, p_user_id) then
    raise exception 'assignee_not_member';
  end if;
  select user_id into v_old from survey_assignments
   where survey_id = p_survey_id and kind = 'owner' for update;
  if v_old = p_user_id then
    return;
  end if;
  perform set_config('survey.assign', 'on', true);
  if v_old is not null then
    if is_active_member(v_ws, v_old) then
      update survey_assignments set kind = 'collaborator' where survey_id = p_survey_id and user_id = v_old;
    else
      delete from survey_assignments where survey_id = p_survey_id and user_id = v_old;
    end if;
  end if;
  insert into survey_assignments as a (survey_id, workspace_id, user_id, kind, assigned_by)
  values (p_survey_id, v_ws, p_user_id, 'owner', auth.uid())
  on conflict (survey_id, user_id) do update
    set kind = 'owner', assigned_by = excluded.assigned_by, assigned_at = now();
  perform set_config('survey.assign', v_prev, true);
  perform write_activity(v_ws, 'survey', p_survey_id, 'assignment.owner',
    jsonb_build_object('owner', jsonb_build_array(v_old, p_user_id)));
end $$;

-- Decision: adding someone who is already a collaborator is a no-op; adding
-- the owner as a collaborator raises invalid_target.
create or replace function add_survey_collaborator(p_survey_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws   uuid := survey_for_assignment(p_survey_id);
  v_kind text;
  v_prev text := coalesce(current_setting('survey.assign', true), '');
begin
  if p_user_id is null then
    raise exception 'invalid_target';
  end if;
  select kind into v_kind from survey_assignments where survey_id = p_survey_id and user_id = p_user_id;
  if v_kind = 'owner' then
    raise exception 'invalid_target';
  elsif v_kind = 'collaborator' then
    return;
  end if;
  if not is_active_member(v_ws, p_user_id) then
    raise exception 'assignee_not_member';
  end if;
  perform set_config('survey.assign', 'on', true);
  insert into survey_assignments (survey_id, workspace_id, user_id, kind, assigned_by)
  values (p_survey_id, v_ws, p_user_id, 'collaborator', auth.uid());
  perform set_config('survey.assign', v_prev, true);
  perform write_activity(v_ws, 'survey', p_survey_id, 'assignment.collaborator_add',
    jsonb_build_object('collaborator', jsonb_build_array(null, p_user_id)));
end $$;

-- Decision: removing someone who is not a collaborator is a no-op (a double
-- click never errors); the owner is never removed here (invalid_target), it
-- changes through set_survey_owner.
create or replace function remove_survey_collaborator(p_survey_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws   uuid := survey_for_assignment(p_survey_id);
  v_kind text;
begin
  select kind into v_kind from survey_assignments where survey_id = p_survey_id and user_id = p_user_id for update;
  if v_kind is null then
    return;
  end if;
  if v_kind = 'owner' then
    raise exception 'invalid_target';
  end if;
  delete from survey_assignments where survey_id = p_survey_id and user_id = p_user_id;
  perform write_activity(v_ws, 'survey', p_survey_id, 'assignment.collaborator_remove',
    jsonb_build_object('collaborator', jsonb_build_array(p_user_id, null)));
end $$;

revoke all on function set_survey_owner(uuid, uuid), add_survey_collaborator(uuid, uuid),
  remove_survey_collaborator(uuid, uuid) from public, anon;
grant execute on function set_survey_owner(uuid, uuid), add_survey_collaborator(uuid, uuid),
  remove_survey_collaborator(uuid, uuid) to authenticated;

-- Owned surveys per member, for the members page. Every member, zero
-- included. Decision: archived surveys are not counted.
create or replace function member_owned_survey_counts(p_workspace_id uuid)
returns table (user_id uuid, owned_surveys int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not is_member(p_workspace_id) then
    raise exception 'not_authorized';
  end if;
  return query
    select m.user_id,
           (select count(*)::int from survey_assignments a join surveys s on s.id = a.survey_id
             where a.workspace_id = p_workspace_id and a.user_id = m.user_id and a.kind = 'owner'
               and s.archived_at is null)
      from workspace_members m
     where m.workspace_id = p_workspace_id;
end $$;
revoke all on function member_owned_survey_counts(uuid) from public, anon;
grant execute on function member_owned_survey_counts(uuid) to authenticated;

-- ===========================================================================
-- R19. Member removal. Every removal path (RLS delete by an admin or the
-- member themself, admin_remove_workspace_member, profile deletion) ends in
-- a workspace_members delete, so one after delete trigger covers them all.
-- Collaborator rows go; owned surveys move to the member who removed them.
-- Decision: when the member leaves on their own, or the remover is not an
-- active member (a platform admin, the service role), owned surveys go to the
-- workspace owner; with no eligible heir they become unassigned. Each moved
-- survey writes one activity_log row (assignment.reassign).
-- ===========================================================================
create or replace function reassign_surveys_on_member_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev  text := coalesce(current_setting('survey.assign', true), '');
  v_actor uuid := auth.uid();
  v_heir  uuid;
  r       record;
begin
  if flag_on('survey.purge') then
    return old;
  end if;
  perform set_config('survey.assign', 'on', true);
  delete from survey_assignments
   where workspace_id = old.workspace_id and user_id = old.user_id and kind = 'collaborator';

  if v_actor is not null and v_actor <> old.user_id and is_active_member(old.workspace_id, v_actor) then
    v_heir := v_actor;
  else
    select m.user_id into v_heir from workspace_members m
     where m.workspace_id = old.workspace_id and m.role = 'owner' and m.user_id <> old.user_id
       and is_active_member(old.workspace_id, m.user_id);
  end if;

  for r in select a.survey_id from survey_assignments a
            where a.workspace_id = old.workspace_id and a.user_id = old.user_id and a.kind = 'owner'
            for update
  loop
    delete from survey_assignments where survey_id = r.survey_id and user_id = old.user_id;
    if v_heir is not null then
      insert into survey_assignments as a (survey_id, workspace_id, user_id, kind, assigned_by)
      values (r.survey_id, old.workspace_id, v_heir, 'owner', v_actor)
      on conflict (survey_id, user_id) do update
        set kind = 'owner', assigned_by = excluded.assigned_by, assigned_at = now();
    end if;
    perform write_activity(old.workspace_id, 'survey', r.survey_id, 'assignment.reassign',
      jsonb_build_object('owner', jsonb_build_array(old.user_id, v_heir)));
  end loop;
  perform set_config('survey.assign', v_prev, true);
  return old;
end $$;
revoke all on function reassign_surveys_on_member_delete() from public, anon, authenticated;
create trigger workspace_members_reassign_surveys after delete on workspace_members
  for each row execute function reassign_surveys_on_member_delete();

-- ===========================================================================
-- R20. Directory: display name and avatar of active profiles, never email.
-- Decision: only an active profile may read it (a pending sign-in may not
-- browse the organization's people).
-- ===========================================================================
create or replace function directory_profiles()
returns table (id uuid, display_name text, avatar_url text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not is_active_profile() then
    raise exception 'not_authorized';
  end if;
  return query
    select p.id, p.display_name, p.avatar_url from profiles p
     where p.status = 'active'
     order by p.display_name, p.id;
end $$;
revoke all on function directory_profiles() from public, anon;
grant execute on function directory_profiles() to authenticated;

-- ===========================================================================
-- R20. Direct membership. Ownership still changes only through
-- transfer_workspace_ownership: none of these accept or touch the owner role.
-- ===========================================================================

-- Internal: refuse owner, null, and an unknown role text before any lookup.
create or replace function assignable_member_role(p_role workspace_role) returns workspace_role
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_role is null or p_role = 'owner' then
    raise exception 'invalid_role';
  end if;
  return p_role;
end $$;
revoke all on function assignable_member_role(workspace_role) from public, anon, authenticated;

-- Internal: insert a member past guard_workspace_member (flag survey.internal).
create or replace function insert_member_direct(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('survey.internal', true), '');
begin
  if not exists (select 1 from profiles where id = p_user_id and status = 'active') then
    raise exception 'target_not_active';
  end if;
  if exists (select 1 from workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then
    raise exception 'already_member';
  end if;
  perform set_config('survey.internal', 'on', true);
  insert into workspace_members (workspace_id, user_id, role) values (p_workspace_id, p_user_id, assignable_member_role(p_role));
  perform set_config('survey.internal', v_prev, true);
end $$;
revoke all on function insert_member_direct(uuid, uuid, workspace_role) from public, anon, authenticated;

-- R20: owner or admin of that workspace (not archived), role at or below the
-- caller's and never owner. An admin may therefore add another admin: R20
-- says "at or below their own", which is wider than doc 05's invite rule.
-- The member insert's own log_activity row is suppressed and replaced by one
-- explicit 'member' 'add' row so the log says how they joined.
create or replace function add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role workspace_role;
  v_me   workspace_role;
  v_skip text := coalesce(current_setting('survey.skip_log', true), '');
begin
  if not is_member(p_workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  v_role := assignable_member_role(p_role);
  v_me := caller_role(p_workspace_id);
  if v_role > v_me then
    raise exception 'invalid_role';
  end if;
  perform set_config('survey.skip_log', 'on', true);
  perform insert_member_direct(p_workspace_id, p_user_id, v_role);
  perform set_config('survey.skip_log', v_skip, true);
  perform write_activity(p_workspace_id, 'member', p_user_id, 'add',
    jsonb_build_object('role', jsonb_build_array(null, v_role)));
end $$;
revoke all on function add_workspace_member(uuid, uuid, workspace_role) from public, anon;
grant execute on function add_workspace_member(uuid, uuid, workspace_role) to authenticated;

-- R20: platform admin, any active user, any role but owner. Decision: allowed
-- on an archived workspace (membership is not workspace data), refused once
-- deletion was requested. The member trigger logs activity_log; this writes
-- platform_audit_log.
create or replace function admin_add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role workspace_role;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  v_role := assignable_member_role(p_role);
  if not exists (select 1 from workspaces where id = p_workspace_id and deleted_at is null) then
    raise exception 'not_found';
  end if;
  perform insert_member_direct(p_workspace_id, p_user_id, v_role);
  perform write_platform_audit('member.add', 'workspace', p_workspace_id,
    jsonb_build_object('user_id', p_user_id, 'role', v_role));
end $$;

-- R20: platform admin removes anyone but the owner (transfer first). Owned
-- surveys go to the workspace owner through the member delete trigger.
create or replace function admin_remove_workspace_member(p_workspace_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role workspace_role;
  v_prev text := coalesce(current_setting('survey.internal', true), '');
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  select role into v_role from workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id for update;
  if v_role is null then
    raise exception 'target_not_member';
  end if;
  if v_role = 'owner' then
    raise exception 'invalid_target';
  end if;
  perform set_config('survey.internal', 'on', true);
  delete from workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  perform set_config('survey.internal', v_prev, true);
  perform write_platform_audit('member.remove', 'workspace', p_workspace_id,
    jsonb_build_object('user_id', p_user_id, 'role', v_role));
end $$;

-- R20: platform admin changes a non-owner's role to any role but owner.
-- Setting the same role is a no-op and writes nothing.
create or replace function admin_set_member_role(p_workspace_id uuid, p_user_id uuid, p_role workspace_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new  workspace_role;
  v_old  workspace_role;
  v_prev text := coalesce(current_setting('survey.internal', true), '');
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  v_new := assignable_member_role(p_role);
  select role into v_old from workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id for update;
  if v_old is null then
    raise exception 'target_not_member';
  end if;
  if v_old = 'owner' then
    raise exception 'invalid_target';
  end if;
  if v_old = v_new then
    return;
  end if;
  perform set_config('survey.internal', 'on', true);
  update workspace_members set role = v_new where workspace_id = p_workspace_id and user_id = p_user_id;
  perform set_config('survey.internal', v_prev, true);
  perform write_platform_audit('member.role_change', 'workspace', p_workspace_id,
    jsonb_build_object('user_id', p_user_id, 'from', v_old, 'to', v_new));
end $$;

revoke all on function admin_add_workspace_member(uuid, uuid, workspace_role),
  admin_remove_workspace_member(uuid, uuid), admin_set_member_role(uuid, uuid, workspace_role) from public, anon;
grant execute on function admin_add_workspace_member(uuid, uuid, workspace_role),
  admin_remove_workspace_member(uuid, uuid), admin_set_member_role(uuid, uuid, workspace_role) to authenticated;

-- ===========================================================================
-- R19 backfill for databases that already hold surveys: the creator becomes
-- the owner when still an active member. Insert only; runs once.
-- ===========================================================================
insert into survey_assignments (survey_id, workspace_id, user_id, kind, assigned_by, assigned_at)
select s.id, s.workspace_id, s.created_by, 'owner', s.created_by, s.created_at
  from surveys s
 where s.created_by is not null
   and is_active_member(s.workspace_id, s.created_by)
on conflict do nothing;

-- Anon invariant (AGENTS.md rule 2), restated as in 0019.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function resolve_public_survey(text)       to anon, authenticated, service_role;
grant execute on function get_public_definition(uuid, text) to anon;
