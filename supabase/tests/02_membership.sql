-- is_member role ordering, archive read-only, member guard, ownership
-- transfer, effective_limits merging overrides over defaults.
begin;

select tests.new_user('owner');
select tests.new_user('admin1');
select tests.new_user('editor1');
select tests.new_user('viewer1');
select tests.new_user('outsider');
select tests.new_user('pendinguser', 'pending');
select tests.new_user('pa', 'active', true);
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('admin1'), 'admin');
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');
select tests.add_member(tests.id('acme'), tests.id('pendinguser'), 'editor');

-- Role ordering: viewer < editor < admin < owner
select tests.as_user('viewer1');
do $$ begin
  assert public.is_member(tests.id('acme'), 'viewer'), 'viewer >= viewer';
  assert not public.is_member(tests.id('acme'), 'editor'), 'viewer < editor';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert public.is_member(tests.id('acme'), 'viewer') and public.is_member(tests.id('acme'), 'editor'), 'editor >= editor';
  assert not public.is_member(tests.id('acme'), 'admin'), 'editor < admin';
end $$;
select tests.as_user('admin1');
do $$ begin
  assert public.is_member(tests.id('acme'), 'admin'), 'admin >= admin';
  assert not public.is_member(tests.id('acme'), 'owner'), 'admin < owner';
end $$;
select tests.as_user('owner');
do $$ begin
  assert public.is_member(tests.id('acme'), 'owner') and public.is_member(tests.id('acme')), 'owner >= all';
end $$;
select tests.as_user('outsider');
do $$ begin
  assert not public.is_member(tests.id('acme')), 'outsider is not a member';
  assert (select count(*) from public.workspaces where id = tests.id('acme')) = 0, 'outsider cannot see the workspace';
end $$;
select tests.as_user('pendinguser');
do $$ begin
  assert not public.is_member(tests.id('acme')), 'a pending profile is not an effective member';
end $$;

-- effective_limits: defaults, then overrides merged over defaults
select tests.as_user('viewer1');
do $$
declare l record;
begin
  select * into l from public.effective_limits(tests.id('acme'));
  assert l.max_file_bytes = 26214400 and l.max_files_per_response = 20 and l.max_questions = 300
     and l.max_definition_bytes = 1048576 and l.rate_limit_per_hour = 20 and not l.raw_script_pixels_allowed,
    'global defaults (0019 S3: script pixels off by default)';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$select public.admin_set_workspace_limits(tests.id('acme'), '{"max_questions": 50}', 'x')$q$)
         = 'not_authorized', 'only a platform admin sets limits';
end $$;
select tests.as_user('pa');
do $$ begin
  assert tests.err($q$select public.admin_set_workspace_limits(tests.id('acme'), '{"max_questions": 50}', '  ')$q$)
         = 'note_required', 'note is required';
  assert tests.err($q$select public.admin_set_workspace_limits(tests.id('acme'), '{"bogus": 1}', 'n')$q$)
         like 'unknown_limit%', 'unknown keys refused';
  perform public.admin_set_workspace_limits(tests.id('acme'),
    '{"max_questions": 50, "rate_limit_per_hour": 5, "raw_script_pixels_allowed": false}', 'Pilot department');
end $$;
select tests.as_user('viewer1');
do $$
declare l record;
begin
  select * into l from public.effective_limits(tests.id('acme'));
  assert l.max_questions = 50 and l.rate_limit_per_hour = 5 and not l.raw_script_pixels_allowed, 'overrides applied';
  assert l.max_file_bytes = 26214400 and l.max_files_per_response = 20 and l.max_definition_bytes = 1048576,
    'null override columns fall back to defaults';
end $$;
select tests.as_user('outsider');
do $$ begin
  assert (select count(*) from public.effective_limits(tests.id('acme'))) = 0, 'outsider gets no limits row';
end $$;

-- Member guard: admins manage editors and viewers only; owner rows are fn-only
select tests.as_user('admin1');
do $$ begin
  assert tests.err($q$update public.workspace_members set role = 'admin'
                      where workspace_id = tests.id('acme') and user_id = tests.id('editor1')$q$)
         like 'Only the owner can promote%', 'admin cannot promote to admin';
  update public.workspace_members set role = 'viewer'
   where workspace_id = tests.id('acme') and user_id = tests.id('editor1');
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('editor1'))
         = 'viewer', 'admin can demote an editor';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$update public.workspace_members set role = 'admin'
                      where workspace_id = tests.id('acme') and user_id = tests.id('owner')$q$) is not null,
    'owner row cannot change by update';
  update public.workspace_members set role = 'admin'
   where workspace_id = tests.id('acme') and user_id = tests.id('viewer1');
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('viewer1'))
         = 'admin', 'owner can promote to admin';
  -- transfer ownership
  perform public.transfer_workspace_ownership(tests.id('acme'), tests.id('admin1'));
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('admin1'))
         = 'owner', 'new owner';
  assert (select role from public.workspace_members where workspace_id = tests.id('acme') and user_id = tests.id('owner'))
         = 'admin', 'old owner becomes admin';
end $$;

-- Archived workspace: read only
reset role;
select tests.clear_claims();
select set_config('survey.lifecycle', 'on', true);
update public.workspaces set archived_at = now() where id = tests.id('acme');
select set_config('survey.lifecycle', 'off', true);
select tests.as_user('admin1');
do $$ begin
  assert public.is_member(tests.id('acme'), 'viewer'), 'archived: still readable';
  assert not public.is_member(tests.id('acme'), 'editor'), 'archived: writes frozen';
end $$;

rollback;
