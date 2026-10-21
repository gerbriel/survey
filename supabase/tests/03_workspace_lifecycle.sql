-- Workspace lifecycle guards (docs/01 section 2, docs/05 sections 1.3 and 1.4):
-- archive, at least 7 days archived, delete request, 30 day restore window,
-- purge only after the window.
begin;

select tests.new_user('owner');
select tests.new_user('pa', 'active', true);
select tests.new_workspace('dept', tests.id('owner'));
select tests.new_user('pa_creator_owner');

-- admin_create_workspace: platform admin only, built-in views, audit row
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$select public.admin_create_workspace('X', 'xdept', tests.id('owner'))$q$) = 'not_authorized',
    'members cannot create workspaces';
end $$;
select tests.as_user('pa');
do $$
declare v_ws uuid;
begin
  v_ws := public.admin_create_workspace('Training', 'training', tests.id('pa_creator_owner'));
  perform tests.put('training', v_ws);
  assert tests.err($q$select public.admin_create_workspace('Dup', 'training', tests.id('owner'))$q$) = 'slug_taken',
    'live slug refused';
  assert tests.err($q$select public.admin_create_workspace('Bad', 'admin', tests.id('owner'))$q$) is not null,
    'reserved workspace slug refused';
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert (select count(*) from public.contact_views where workspace_id = tests.id('training') and builtin) = 3,
    'built-in contact views created';
  assert (select role from public.workspace_members where workspace_id = tests.id('training')
          and user_id = tests.id('pa_creator_owner')) = 'owner', 'owner membership';
  assert exists (select 1 from public.platform_audit_log where action = 'workspace.create' and target_id = tests.id('training')),
    'audit row';
end $$;

-- Direct lifecycle writes are refused
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$update public.workspaces set archived_at = now() where id = tests.id('dept')$q$)
         like 'Use archive_workspace%', 'archived_at only through functions';
  assert tests.err($q$update public.workspaces set slug = 'renamed' where id = tests.id('dept')$q$)
         like 'Use rename_workspace_slug%', 'slug only through functions';
  -- cannot delete before archiving
  assert tests.err($q$select public.request_workspace_deletion(tests.id('dept'), (select slug from public.workspaces where id = tests.id('dept')))$q$)
         like 'A workspace must be archived for 7 days%', 'delete before archive refused';
  perform public.archive_workspace(tests.id('dept'));
  assert (select archived_at from public.workspaces where id = tests.id('dept')) is not null, 'archived';
  -- cannot delete before 7 days archived
  assert tests.err($q$select public.request_workspace_deletion(tests.id('dept'), (select slug from public.workspaces where id = tests.id('dept')))$q$)
         like 'A workspace must be archived for 7 days%', 'delete within 7 days refused';
end $$;

-- 8 days later
reset role;
select tests.clear_claims();
select set_config('survey.lifecycle', 'on', true);
update public.workspaces set archived_at = now() - interval '8 days' where id = tests.id('dept');
select set_config('survey.lifecycle', 'off', true);

select tests.as_user('owner');
do $$ begin
  assert tests.err($q$select public.request_workspace_deletion(tests.id('dept'), 'wrong-slug')$q$) = 'confirm_slug_mismatch',
    'slug confirmation required';
  perform public.request_workspace_deletion(tests.id('dept'), (select slug from public.workspaces where id = tests.id('dept')));
  assert not public.is_member(tests.id('dept')), 'deleted workspace is hidden from members';
  assert tests.err($q$select public.restore_workspace(tests.id('dept'))$q$) = 'not_authorized', 'only platform admins restore';
end $$;

-- Restore inside the 30 day window
select tests.as_user('pa');
do $$ begin
  perform public.restore_workspace(tests.id('dept'));
  assert (select deleted_at from public.workspaces where id = tests.id('dept')) is null, 'restored';
  assert (select archived_at from public.workspaces where id = tests.id('dept')) is not null, 'stays archived after restore';
end $$;

-- Delete again, then 31 days pass: restore refused, purge allowed
select tests.as_user('owner');
select public.request_workspace_deletion(tests.id('dept'), (select slug from public.workspaces where id = tests.id('dept')));
reset role;
select tests.clear_claims();
select set_config('survey.lifecycle', 'on', true);
update public.workspaces set deleted_at = now() - interval '31 days' where id = tests.id('dept');
select set_config('survey.lifecycle', 'off', true);
do $$ begin
  assert tests.err($q$delete from public.workspaces where id = tests.id('dept')$q$) like '%can only be purged%',
    'direct delete refused even after the window';
end $$;

select tests.as_user('pa');
do $$ begin
  assert tests.err($q$select public.restore_workspace(tests.id('dept'))$q$) like 'The 30 day restore window has passed%',
    'restore refused after 30 days';
end $$;

-- purge_workspace: service role only, only when due
select tests.as_service();
do $$
declare v_slug text := (select slug from public.workspaces where id = tests.id('dept'));
begin
  assert tests.err($q$select public.purge_workspace(tests.id('training'))$q$) = 'not_due', 'not due refused';
  assert tests.id('dept') in (select public.workspace_purge_due(10)), 'due list includes it';
  perform public.purge_workspace(tests.id('dept'));
  assert not exists (select 1 from public.workspaces where id = tests.id('dept')), 'purged';
  assert exists (select 1 from public.workspace_slug_history where slug = v_slug and workspace_id is null), 'slug held';
  assert exists (select 1 from public.platform_audit_log where action = 'workspace.purge' and target_id = tests.id('dept')),
    'purge audited';
end $$;

rollback;
