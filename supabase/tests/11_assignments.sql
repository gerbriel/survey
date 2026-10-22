-- Migration 0020 (R19 survey assignment, R20 direct membership): one owner
-- per survey, assignees must be active members, editor assigns and viewer
-- cannot, removal reassigns to the remover, the directory never carries
-- email, the admin and member add functions refuse the owner role and roles
-- above the caller, and the anon invariant still holds.
begin;

select tests.new_user('owner');
select tests.new_user('admin1');
select tests.new_user('editor1');
select tests.new_user('editor2');
select tests.new_user('viewer1');
select tests.new_user('outsider');
select tests.new_user('joiner');
select tests.new_user('pendinguser', 'pending');
select tests.new_user('pa', 'active', true);
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('admin1'), 'admin');
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('editor2'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');

-- The creator becomes the owner (R19).
select tests.as_user('editor1');
select tests.put('s1', public.create_survey(tests.id('acme'), 'Assigned survey', null));
select tests.as_user('editor2');
select tests.put('s2', public.create_survey(tests.id('acme'), 'Second survey', null));
do $$ begin
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s1') and kind = 'owner') = tests.id('editor1'),
    'creator owns the new survey';
  assert (select workspace_id from public.survey_assignments where survey_id = tests.id('s1')) = tests.id('acme'),
    'assignment carries the survey workspace';
end $$;

-- One owner per survey: the partial unique index refuses a second owner row.
reset role;
select tests.clear_claims();
do $$ begin
  assert tests.err(format($q$insert into public.survey_assignments (survey_id, workspace_id, user_id, kind)
                             values (%L, %L, %L, 'owner')$q$, tests.id('s1'), tests.id('acme'), tests.id('editor2')))
         like '%survey_one_owner%', 'a second owner row is refused';
  assert tests.err(format($q$insert into public.survey_assignments (survey_id, workspace_id, user_id, kind)
                             values (%L, %L, %L, 'collaborator')$q$, tests.id('s1'), tests.id('acme'), tests.id('outsider')))
         = 'assignee_not_member', 'the guard refuses a non-member even for a trusted caller';
end $$;

-- Clients have no write path.
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format($q$insert into public.survey_assignments (survey_id, workspace_id, user_id, kind)
                             values (%L, %L, %L, 'collaborator')$q$, tests.id('s1'), tests.id('acme'), tests.id('viewer1')))
         like '%permission denied%', 'no direct insert for members';
  assert tests.err(format($q$delete from public.survey_assignments where survey_id = %L$q$, tests.id('s1')))
         like '%permission denied%', 'no direct delete for members';
end $$;

-- A non-member cannot be assigned.
do $$ begin
  assert tests.err(format('select public.set_survey_owner(%L, %L)', tests.id('s1'), tests.id('outsider')))
         = 'assignee_not_member', 'owner must be a member';
  assert tests.err(format('select public.add_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('outsider')))
         = 'assignee_not_member', 'collaborator must be a member';
  assert tests.err(format('select public.add_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('pendinguser')))
         = 'assignee_not_member', 'a pending profile cannot be assigned';
end $$;

-- An editor can assign.
do $$ begin
  perform public.add_survey_collaborator(tests.id('s1'), tests.id('viewer1'));
  perform public.add_survey_collaborator(tests.id('s1'), tests.id('editor2'));
  perform public.add_survey_collaborator(tests.id('s1'), tests.id('editor2'));   -- no-op
  assert (select count(*) from public.survey_assignments where survey_id = tests.id('s1') and kind = 'collaborator') = 2,
    'two collaborators';
  assert tests.err(format('select public.add_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('editor1')))
         = 'invalid_target', 'the owner is not also a collaborator';
  assert tests.err(format('select public.remove_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('editor1')))
         = 'invalid_target', 'the owner is not removed as a collaborator';
  perform public.remove_survey_collaborator(tests.id('s1'), tests.id('viewer1'));
  perform public.remove_survey_collaborator(tests.id('s1'), tests.id('viewer1'));   -- no-op
  -- Hand over to editor2: still one owner, the previous owner stays as a collaborator.
  perform public.set_survey_owner(tests.id('s1'), tests.id('editor2'));
  assert (select count(*) from public.survey_assignments where survey_id = tests.id('s1') and kind = 'owner') = 1, 'one owner';
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s1') and kind = 'owner') = tests.id('editor2'),
    'editor2 owns s1';
  assert (select kind from public.survey_assignments where survey_id = tests.id('s1') and user_id = tests.id('editor1')) = 'collaborator',
    'previous owner stays as a collaborator';
end $$;

-- A viewer cannot assign; members read.
select tests.as_user('viewer1');
do $$ begin
  assert tests.err(format('select public.add_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('viewer1')))
         = 'not_authorized', 'viewer cannot add';
  assert tests.err(format('select public.set_survey_owner(%L, %L)', tests.id('s1'), tests.id('viewer1')))
         = 'not_authorized', 'viewer cannot set owner';
  assert tests.err(format('select public.remove_survey_collaborator(%L, %L)', tests.id('s1'), tests.id('editor1')))
         = 'not_authorized', 'viewer cannot remove';
  assert (select count(*) from public.survey_assignments where survey_id = tests.id('s1')) = 2, 'viewer reads assignments';
  assert (select owned_surveys from public.member_owned_survey_counts(tests.id('acme')) where user_id = tests.id('editor2')) = 2,
    'editor2 owns two surveys';
  assert (select owned_surveys from public.member_owned_survey_counts(tests.id('acme')) where user_id = tests.id('viewer1')) = 0,
    'zero counts are listed';
end $$;
select tests.as_user('outsider');
do $$ begin
  assert (select count(*) from public.survey_assignments) = 0, 'outsider reads nothing';
  assert tests.err(format('select * from public.member_owned_survey_counts(%L)', tests.id('acme'))) = 'not_authorized',
    'outsider cannot read counts';
  assert tests.err(format('select public.set_survey_owner(%L, %L)', tests.id('s1'), tests.id('outsider'))) = 'not_authorized',
    'outsider cannot assign';
end $$;

-- Assignment changes are in activity_log.
reset role;
select tests.clear_claims();
do $$ begin
  assert (select count(*) from public.activity_log where entity = 'survey' and entity_id = tests.id('s1')
            and action in ('assignment.owner', 'assignment.collaborator_add', 'assignment.collaborator_remove')) = 4,
    'add, add, remove, owner each logged once (no-ops are not)';
end $$;

-- Removal reassigns ownership to the remover and drops collaborator rows.
select tests.as_user('admin1');
delete from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('editor2');
do $$ begin
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s1') and kind = 'owner') = tests.id('admin1'),
    's1 moves to the remover';
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s2') and kind = 'owner') = tests.id('admin1'),
    's2 moves to the remover';
  assert (select count(*) from public.survey_assignments where user_id = tests.id('editor2')) = 0, 'editor2 holds no rows';
  assert (select count(*) from public.activity_log where action = 'assignment.reassign' and actor = tests.id('admin1')) = 2,
    'each moved survey is logged';
end $$;

-- A member who leaves hands their surveys to the workspace owner.
select tests.as_user('admin1');
select public.set_survey_owner(tests.id('s2'), tests.id('editor1'));
select tests.as_user('editor1');
delete from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('editor1');
reset role;
select tests.clear_claims();
do $$ begin
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s2') and kind = 'owner') = tests.id('owner'),
    'leaving hands owned surveys to the workspace owner';
  assert (select count(*) from public.survey_assignments where user_id = tests.id('editor1')) = 0, 'leaver holds no rows';
end $$;

-- Directory: active profiles, display name and avatar only, never email.
do $$
declare v_cols text[];
begin
  select array_agg(n order by n) into v_cols
    from pg_proc p, unnest(p.proargnames) n
   where p.proname = 'directory_profiles' and p.pronamespace = 'public'::regnamespace;
  assert v_cols = array['avatar_url', 'display_name', 'id'], format('directory columns: %s', v_cols);
end $$;
select tests.as_user('viewer1');
do $$ begin
  assert (select count(*) from public.directory_profiles() where id = tests.id('outsider')) = 1, 'directory lists other active users';
  assert (select count(*) from public.directory_profiles() where id = tests.id('pendinguser')) = 0, 'pending profiles are hidden';
  assert (select count(*) from public.directory_profiles() d
           where d.display_name like '%@%' or coalesce(d.avatar_url, '') like '%@%') = 0, 'no value looks like an email';
end $$;
select tests.as_user('pendinguser');
do $$ begin
  assert tests.err('select * from public.directory_profiles()') = 'not_authorized', 'a pending profile cannot read the directory';
end $$;

-- add_workspace_member: owner or admin, role at or below the caller, never owner.
select tests.as_user('viewer1');
do $$ begin
  assert tests.err(format($q$select public.add_workspace_member(%L, %L, 'viewer')$q$, tests.id('acme'), tests.id('joiner')))
         = 'not_authorized', 'a viewer cannot add members';
end $$;
select tests.as_user('admin1');
do $$ begin
  assert tests.err(format($q$select public.add_workspace_member(%L, %L, 'owner')$q$, tests.id('acme'), tests.id('joiner')))
         = 'invalid_role', 'an admin cannot add above their role';
  assert tests.err(format($q$select public.add_workspace_member(%L, %L, 'editor')$q$, tests.id('acme'), tests.id('pendinguser')))
         = 'target_not_active', 'the target must be active';
  assert tests.err(format($q$select public.add_workspace_member(%L, %L, 'editor')$q$, tests.id('acme'), tests.id('viewer1')))
         = 'already_member', 'an existing member is refused';
  perform public.add_workspace_member(tests.id('acme'), tests.id('joiner'), 'admin');   -- R20: at or below own role
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('joiner')) = 'admin',
    'joiner added as admin';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err(format($q$select public.add_workspace_member(%L, %L, 'owner')$q$, tests.id('acme'), tests.id('outsider')))
         = 'invalid_role', 'not even the owner adds an owner';
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert (select count(*) from public.activity_log where entity = 'member' and entity_id = tests.id('joiner')) = 1
     and (select action from public.activity_log where entity = 'member' and entity_id = tests.id('joiner')) = 'add',
    'one member.add activity row';
end $$;

-- admin_* membership functions: platform admin only, never the owner role.
select tests.as_user('owner');
do $$ begin
  assert tests.err(format($q$select public.admin_add_workspace_member(%L, %L, 'viewer')$q$, tests.id('acme'), tests.id('outsider')))
         = 'not_authorized', 'workspace owner is not a platform admin';
  assert tests.err(format($q$select public.admin_remove_workspace_member(%L, %L)$q$, tests.id('acme'), tests.id('viewer1')))
         = 'not_authorized', 'remove is platform admin only';
  assert tests.err(format($q$select public.admin_set_member_role(%L, %L, 'editor')$q$, tests.id('acme'), tests.id('viewer1')))
         = 'not_authorized', 'role change is platform admin only';
end $$;
select tests.as_user('pa');
do $$ begin
  assert tests.err(format($q$select public.admin_add_workspace_member(%L, %L, 'owner')$q$, tests.id('acme'), tests.id('outsider')))
         = 'invalid_role', 'admin_add_workspace_member refuses owner';
  assert tests.err(format($q$select public.admin_set_member_role(%L, %L, 'owner')$q$, tests.id('acme'), tests.id('viewer1')))
         = 'invalid_role', 'admin_set_member_role refuses owner';
  assert tests.err(format($q$select public.admin_set_member_role(%L, %L, 'viewer')$q$, tests.id('acme'), tests.id('owner')))
         = 'invalid_target', 'the owner role is never changed here';
  assert tests.err(format($q$select public.admin_remove_workspace_member(%L, %L)$q$, tests.id('acme'), tests.id('owner')))
         = 'invalid_target', 'the owner is never removed here';
  assert tests.err(format($q$select public.admin_remove_workspace_member(%L, %L)$q$, tests.id('acme'), tests.id('outsider')))
         = 'target_not_member', 'removing a non-member';
  perform public.admin_add_workspace_member(tests.id('acme'), tests.id('outsider'), 'editor');
  perform public.admin_set_member_role(tests.id('acme'), tests.id('outsider'), 'admin');
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('outsider')) = 'admin',
    'role changed';
end $$;
-- The added member creates a survey; the platform admin removes them; it goes to the workspace owner.
select tests.as_user('outsider');
select tests.put('s3', public.create_survey(tests.id('acme'), 'Third survey', null));
select tests.as_user('pa');
select public.admin_remove_workspace_member(tests.id('acme'), tests.id('outsider'));
reset role;
select tests.clear_claims();
do $$ begin
  assert (select user_id from public.survey_assignments where survey_id = tests.id('s3') and kind = 'owner') = tests.id('owner'),
    'a non-member remover hands surveys to the workspace owner';
  assert (select count(*) from public.platform_audit_log where actor = tests.id('pa') and target_id = tests.id('acme')
            and action in ('member.add', 'member.role_change', 'member.remove')) = 3, 'platform audit rows';
end $$;

-- Anon invariant (same assertion as 01_anon_privileges.sql).
do $$
declare
  v_tables text[];
  v_funcs  text[];
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and ((c.relkind in ('r', 'v', 'm', 'p', 'f')
          and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
      or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')));
  assert v_tables is null, format('anon holds table privileges on: %s', v_tables);

  select array_agg(p.proname::text order by p.proname) into v_funcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert v_funcs = array['get_public_definition', 'resolve_public_survey'],
    format('anon can execute: %s', v_funcs);
end $$;

rollback;
