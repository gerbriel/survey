-- create_survey, draft lock, save_draft revisions, publish_survey_version
-- (stale revision, server-only keys, key validation, key stability),
-- published version immutability.
begin;

select tests.new_user('owner');
select tests.new_user('editor1');
select tests.new_user('editor2');
select tests.new_user('viewer1');
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('editor2'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');

select tests.as_user('viewer1');
do $$ begin
  assert tests.err($q$select public.create_survey(tests.id('acme'), 'Nope')$q$) = 'not_authorized', 'viewer cannot create';
end $$;

select tests.as_user('editor1');
do $$
declare v_s uuid; v_v uuid; v_lock jsonb;
begin
  v_s := public.create_survey(tests.id('acme'), 'Leads', '00000000-0000-4000-8000-000000000003');
  perform tests.put('leads', v_s);
  select current_draft_version_id into v_v from public.surveys where id = v_s;
  perform tests.put('leads_v1', v_v);
  assert (select slug from public.surveys where id = v_s) ~ '^[a-z0-9]{10}$', 'random slug';
  v_lock := public.take_draft_lock(v_v, false);
  assert (v_lock ->> 'ok')::boolean and (v_lock ->> 'revision')::int = 0, 'lock taken';
end $$;

-- Another editor sees the lock, then forces a takeover (revision bumps)
select tests.as_user('editor2');
do $$
declare v_lock jsonb;
begin
  v_lock := public.take_draft_lock(tests.id('leads_v1'), false);
  assert not (v_lock ->> 'ok')::boolean and (v_lock ->> 'locked_by')::uuid = tests.id('editor1'), 'lock held by editor1';
  v_lock := public.take_draft_lock(tests.id('leads_v1'), true);
  assert (v_lock ->> 'ok')::boolean and (v_lock ->> 'revision')::int = 1, 'forced takeover bumps revision';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert tests.err($q$select public.save_draft(tests.id('leads_v1'), 1,
                      (select definition from public.survey_versions where id = tests.id('leads_v1')))$q$) = 'lock_lost',
    'previous holder loses the lock';
end $$;

select tests.as_user('editor2');
do $$
declare v_def jsonb; v_rev int;
begin
  select definition into v_def from public.survey_versions where id = tests.id('leads_v1');
  v_rev := public.save_draft(tests.id('leads_v1'), 1, v_def);
  assert v_rev = 2, 'save bumps revision';
  assert tests.err(format('select public.save_draft(%L, 1, %L::jsonb)', tests.id('leads_v1'), v_def)) = 'revision_conflict',
    'stale save refused';

  -- publish: stale revision refused
  assert tests.err(format('select public.publish_survey_version(%L, 1, %L::jsonb)', tests.id('leads_v1'), v_def))
         = 'revision_conflict', 'stale publish refused';
  -- publish: any server-only key at any depth refused
  assert tests.err(format('select public.publish_survey_version(%L, 2, %L::jsonb)', tests.id('leads_v1'),
           jsonb_set(v_def, '{questions,q_lead0006,settings,options,0,score}', '1')))
         like 'server_only_key_in_public_definition: score%', 'nested score refused';
  assert tests.err(format('select public.publish_survey_version(%L, 2, %L::jsonb)', tests.id('leads_v1'),
           v_def || '{"extra": [{"deep": {"correct_option_id": "o_1"}}]}'))
         like 'server_only_key_in_public_definition: correct_option_id%', 'deep correct_option_id refused';
end $$;

-- Invalid question key blocks publish
select tests.as_user('editor2');
do $$
declare v_def jsonb; v_bad jsonb;
begin
  select definition into v_def from public.survey_versions where id = tests.id('leads_v1');
  v_bad := jsonb_set(v_def, '{questions,q_lead0007,question_key}', '"Bad Key"');
  perform public.save_draft(tests.id('leads_v1'), 2, v_bad);
  assert tests.err(format('select public.publish_survey_version(%L, 3, %L::jsonb)', tests.id('leads_v1'), v_bad))
         like 'invalid_question_key%', 'bad key refused';
  -- duplicate option ids block publish
  v_bad := jsonb_set(v_def, '{questions,q_lead0006,settings,options,1,id}', '"o_1"');
  perform public.save_draft(tests.id('leads_v1'), 3, v_bad);
  assert tests.err(format('select public.publish_survey_version(%L, 4, %L::jsonb)', tests.id('leads_v1'), v_bad))
         like 'duplicate_option_id%', 'duplicate option id refused';
  perform public.save_draft(tests.id('leads_v1'), 4, v_def);
  perform tests.put('leads_v2', public.publish_survey_version(tests.id('leads_v1'), 5, v_def));
end $$;

reset role;
select tests.clear_claims();
do $$ begin
  assert (select status from public.survey_versions where id = tests.id('leads_v1')) = 'published', 'published';
  assert (select count(*) from public.questions where survey_version_id = tests.id('leads_v1')) = 7, 'questions snapshot';
  assert (select latest_published_version_id from public.surveys where id = tests.id('leads')) = tests.id('leads_v1'), 'pointer';
  assert (select current_draft_version_id from public.surveys where id = tests.id('leads')) = tests.id('leads_v2'), 'new draft';
  assert (select identity_question_key from public.surveys where id = tests.id('leads')) = 'q_lead0003', 'identity synced';
  assert (select version_no from public.survey_versions where id = tests.id('leads_v2')) = 2, 'draft is version 2';
  -- Published version refuses update and delete, even for postgres
  assert tests.err($q$update public.survey_versions set definition = '{}' where id = tests.id('leads_v1')$q$)
         like 'Published version % is immutable', 'published update refused';
  assert tests.err($q$update public.survey_versions set revision = 99 where id = tests.id('leads_v1')$q$)
         like 'Published version % is immutable', 'published revision update refused';
  assert tests.err($q$delete from public.survey_versions where id = tests.id('leads_v1')$q$)
         = 'Published versions cannot be deleted', 'published delete refused';
  assert tests.err($q$insert into public.questions (survey_version_id, survey_id, workspace_id, question_key, page_index,
                      position, type, label, label_hash) values (tests.id('leads_v1'), tests.id('leads'), tests.id('acme'),
                      'q_aaaaaaaa', 0, 99, 'short_text', 'x', 'x')$q$) like 'questions are written only%', 'questions fn only';
end $$;

-- Clients have no update path to versions; guarded survey columns refuse
select tests.as_user('editor1');
do $$ begin
  update public.survey_versions set definition = '{}' where id = tests.id('leads_v2');
  assert (select definition <> '{}'::jsonb from public.survey_versions where id = tests.id('leads_v2')), 'no client update policy';
  assert tests.err($q$update public.surveys set complete_count = 5 where id = tests.id('leads')$q$)
         like 'These survey columns%', 'complete_count guarded';
  update public.surveys set title = 'Leads 2026' where id = tests.id('leads');
  assert (select title from public.surveys where id = tests.id('leads')) = 'Leads 2026', 'editor edits title';
end $$;

-- Key stability: a key cannot come back with a different storage column
select tests.as_user('editor1');
do $$
declare v_def jsonb;
begin
  perform public.take_draft_lock(tests.id('leads_v2'), true);
  select definition into v_def from public.survey_versions where id = tests.id('leads_v2');
  v_def := jsonb_set(v_def, '{questions,q_lead0004,type}', '"number"');
  perform public.save_draft(tests.id('leads_v2'), 1, v_def);
  assert tests.err(format('select public.publish_survey_version(%L, 2, %L::jsonb)', tests.id('leads_v2'), v_def))
         = 'key_type_conflict: q_lead0004', 'storage column change refused';
end $$;

-- Quiz template keeps scores in the full definition; publishing it unsplit is refused
select tests.as_user('editor1');
do $$
declare v_s uuid; v_v uuid; v_def jsonb;
begin
  v_s := public.create_survey(tests.id('acme'), 'Quiz', '00000000-0000-4000-8000-000000000005');
  select current_draft_version_id into v_v from public.surveys where id = v_s;
  perform public.take_draft_lock(v_v, false);
  select definition into v_def from public.survey_versions where id = v_v;
  assert tests.err(format('select public.publish_survey_version(%L, 0, %L::jsonb)', v_v, v_def))
         like 'server_only_key_in_public_definition%', 'unsplit quiz refused';
end $$;

-- Only admins delete surveys; deletion retires the alias (held 30 days)
select tests.as_user('editor1');
select public.set_survey_alias(tests.id('leads'), 'lead-form');
do $$ begin
  assert tests.err($q$select public.delete_survey(tests.id('leads'))$q$) = 'not_authorized', 'editor cannot delete';
end $$;
select tests.as_user('owner');
select public.delete_survey(tests.id('leads'));
reset role;
select tests.clear_claims();
do $$ begin
  assert not exists (select 1 from public.surveys where id = tests.id('leads')), 'survey deleted';
  assert exists (select 1 from public.survey_aliases where alias = 'lead-form' and survey_id is null and retired_at is not null),
    'alias held after delete';
end $$;

rollback;
