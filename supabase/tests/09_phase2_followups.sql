-- Migration 0018 (Phase 2 follow-ups): multiple_choice {ids, other},
-- resolve_public_survey.workspace_id, reserved segments, log_export,
-- finish_import, admin_workspace_stats, invite_preview,
-- workspace_members_with_email, pending_storage_deletions, the admin_* audit
-- functions, hash_share_password, report_share_gate, contact custom field
-- filters, matrix labels in shared_report_payload, anonymize strips Other text.
begin;

-- Publish a copy of any system template (as postgres). Fixtures '<name>' and '<name>_v1'.
create or replace function pg_temp.publish_template(p_name text, p_workspace uuid, p_editor text, p_template uuid)
returns uuid language plpgsql as $$
declare v_survey uuid; v_version uuid; v_def jsonb;
begin
  perform tests.as_user(p_editor);
  v_survey := public.create_survey(p_workspace, p_name, p_template);
  select current_draft_version_id into v_version from public.surveys where id = v_survey;
  perform public.take_draft_lock(v_version, false);
  select definition into v_def from public.survey_versions where id = v_version;
  perform public.publish_survey_version(v_version, 0, v_def);
  update public.surveys set state = 'open' where id = v_survey;
  perform set_config('role', 'none', true);
  perform tests.clear_claims();
  perform tests.put(p_name || '_v1', v_version);
  return tests.put(p_name, v_survey);
end $$;

create or replace function pg_temp.submit(p_survey text, p_answers jsonb) returns jsonb
language sql as $$
  select public.submit_response(jsonb_build_object('action', 'complete', 'survey_id', tests.id(p_survey),
    'survey_version_id', tests.id(p_survey || '_v1'), 'idempotency_key', gen_random_uuid(),
    'answers', p_answers, 'visible_keys', '[]'::jsonb, 'respondent_hash', 'rid-' || md5(random()::text))) $$;
grant execute on all functions in schema pg_temp to service_role;

select tests.new_user('owner');
select tests.new_user('admin1');
select tests.new_user('editor1');
select tests.new_user('viewer1');
select tests.new_user('outsider');
select tests.new_user('pa', 'active', true);
select tests.new_workspace('acme', tests.id('owner'));
select tests.new_workspace('other', tests.id('outsider'));
select tests.add_member(tests.id('acme'), tests.id('admin1'), 'admin');
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');
select pg_temp.publish_template('event', tests.id('acme'), 'editor1', '00000000-0000-4000-8000-000000000002');
select pg_temp.publish_template('pulse', tests.id('acme'), 'editor1', '00000000-0000-4000-8000-000000000004');
select tests.published_survey('leads', tests.id('acme'), 'editor1');

-- 1. answer_row: multiple_choice array or {ids, other}; unknown ids still refused
do $$
declare v_opts jsonb := '[{"id": "o_1", "label": "A"}, {"id": "o_2", "label": "B"}]';
begin
  assert public.answer_row('multiple_choice', v_opts, '{}', '["o_1", "o_2"]') = '{"value_json": ["o_1", "o_2"]}', 'array form';
  assert public.answer_row('multiple_choice', v_opts, '{}', '{"ids": ["o_2"], "other": " Bikes "}')
         = '{"value_json": {"ids": ["o_2"], "other": "Bikes"}}', 'object form keeps ids and trimmed other';
  assert public.answer_row('multiple_choice', v_opts, '{}', '{"ids": ["o_1"], "other": "  "}') = '{"value_json": ["o_1"]}',
    'blank other collapses to the array';
  assert public.answer_row('multiple_choice', v_opts, '{}', '{"value_json": {"ids": ["o_1"], "other": "x"}}')
         = '{"value_json": {"ids": ["o_1"], "other": "x"}}', 'toAnswerRow row form';
  assert tests.err($q$select public.answer_row('multiple_choice', '[{"id": "o_1"}]', '{}', '{"ids": ["o_9"], "other": "x"}')$q$)
         = 'unknown_option', 'unknown id in object form';
  assert tests.err($q$select public.answer_row('multiple_choice', '[{"id": "o_1"}]', '{}', '["o_9"]')$q$) = 'unknown_option',
    'unknown id in array form';
  assert tests.err($q$select public.answer_row('multiple_choice', '[{"id": "o_1"}]', '{}', '{"ids": ["o_1"], "x": 1}')$q$) = 'type',
    'unexpected key';
  assert tests.err($q$select public.answer_row('multiple_choice', '[{"id": "o_1"}]', '{}', '{"ids": "o_1"}')$q$) = 'type',
    'ids must be an array';
  assert tests.err($q$select public.answer_row('ranking', '[{"id": "o_1"}]', '{}', '{"ids": ["o_1"]}')$q$) = 'unknown_option',
    'ranking stays array only';
  assert public.answer_row('single_choice', v_opts, '{}', '{"id": "o_2", "other": "Mine"}')
         = '{"value_text": "o_2", "value_json": {"other": "Mine"}}', 'single choice {id, other}';
  assert public.answer_row('dropdown', v_opts, '{}', '{"id": "o_1"}') = '{"value_text": "o_1"}', 'dropdown {id}';
  assert tests.err($q$select public.answer_row('single_choice', '[{"id": "o_1"}]', '{}', '{"id": "o_9", "other": "x"}')$q$)
         = 'unknown_option', 'single choice unknown id';
  assert public.multi_choice_ids('{"ids": ["a"], "other": "x"}') = '["a"]' and public.multi_choice_ids('["b"]') = '["b"]'
     and public.multi_choice_ids(null) = '[]', 'multi_choice_ids';
end $$;

-- End to end: submit both shapes, aggregate and filter count them
select tests.as_service();
do $$
declare v_res jsonb;
begin
  for i in 1..3 loop
    v_res := pg_temp.submit('event', jsonb_build_object('q_evfb0001', 4, 'q_evfb0003', 1,
               'q_evfb0002', jsonb_build_object('ids', jsonb_build_array('o_1', 'o_3'), 'other', 'Food ' || i)));
    assert (v_res ->> 'ok')::boolean, format('object form submit: %s', v_res);
  end loop;
  v_res := pg_temp.submit('event', '{"q_evfb0001": 5, "q_evfb0003": 0, "q_evfb0002": ["o_1"]}');
  assert (v_res ->> 'ok')::boolean, format('array form submit: %s', v_res);
  v_res := pg_temp.submit('event', '{"q_evfb0001": 5, "q_evfb0003": 0, "q_evfb0002": {"ids": ["o_9"], "other": "x"}}');
  assert v_res -> 'field_errors' ->> 'q_evfb0002' = 'unknown_option', format('unknown id refused: %s', v_res);
  assert (select count(*) from public.answers where survey_id = tests.id('event') and question_key = 'q_evfb0002'
          and value_json ->> 'other' like 'Food %') = 3, 'other stored in value_json.other';
  assert (select count(*) from public.answers where survey_id = tests.id('event') and question_key = 'q_evfb0002'
          and value_json -> 'ids' = '["o_1", "o_3"]') = 3, 'ids stored in value_json.ids';
end $$;
reset role;
select tests.clear_claims();
do $$
declare v jsonb;
begin
  v := public.report_widget_data(tests.id('event'), '{}', 'q_evfb0002', null);
  assert (select (e ->> 'count')::int from jsonb_array_elements(v -> 'data') e where e ->> 'option_id' = 'o_1') = 4,
    format('o_1 counted across both shapes: %s', v);
  assert (select (e ->> 'count')::int from jsonb_array_elements(v -> 'data') e where e ->> 'option_id' = 'o_3') = 3,
    'o_3 counted from object form';
end $$;
select tests.as_user('viewer1');
do $$ begin
  assert (select count(*) from public.filtered_responses(tests.id('event'),
          '{"answers": [{"question_key": "q_evfb0002", "any_of": ["o_3"]}]}')) = 3, 'answer filter reads {ids, other}';
end $$;

-- 2. resolve_public_survey returns workspace_id; anon set unchanged (see 01)
reset role;
select tests.clear_claims();
select set_config('tests.leads_slug', (select slug from public.surveys where id = tests.id('leads')), true);
select tests.as_anon();
do $$
declare r record;
begin
  select * into r from public.resolve_public_survey(current_setting('tests.leads_slug'));
  assert r.workspace_id = tests.id('acme'), 'workspace_id returned';
  assert tests.err('select public.invite_preview(''x'')') like '%permission denied%', 'anon cannot preview invites';
  assert tests.err('select public.log_export(gen_random_uuid(), ''summary'', ''{}'', 0)') like '%permission denied%',
    'anon cannot log exports';
end $$;
reset role;
select tests.clear_claims();
do $$
declare v_funcs text[];
begin
  select array_agg(p.proname::text order by p.proname) into v_funcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert v_funcs = array['get_public_definition', 'resolve_public_survey'], format('anon can execute: %s', v_funcs);
end $$;

-- 13. reserved segments
do $$ begin
  assert 'welcome' = any (public.reserved_public_segments()) and 'join' = any (public.reserved_public_segments()), 'reserved';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert tests.err($q$select public.set_survey_alias(tests.id('leads'), 'welcome')$q$) = 'alias_reserved', 'welcome reserved';
end $$;

-- 3. log_export
select tests.as_user('viewer1');
do $$ begin
  perform public.log_export(tests.id('acme'), 'summary', jsonb_build_object('survey_id', tests.id('leads'), 'format', 'csv'), 12);
  assert tests.err($q$select public.log_export(tests.id('acme'), 'responses', '{}', 1)$q$) = 'not_authorized',
    'viewer cannot log a row level export';
end $$;
select tests.as_user('editor1');
do $$ begin
  perform public.log_export(tests.id('acme'), 'responses', jsonb_build_object('survey_id', tests.id('leads'), 'format', 'xlsx'), 5);
  assert tests.err($q$select public.log_export(tests.id('acme'), 'bogus', '{}', 1)$q$) like 'Export kind%', 'kind checked';
  assert tests.err($q$select public.log_export(tests.id('other'), 'summary', '{}', 1)$q$) = 'not_authorized', 'other workspace';
  assert tests.err($q$select public.log_export(tests.id('acme'), 'summary', jsonb_build_object('survey_id', gen_random_uuid()), 1)$q$)
         = 'not_found', 'survey must belong to the workspace';
  assert tests.err($q$select public.log_export(tests.id('acme'), 'summary', '{}', -1)$q$) like 'Export row count%', 'row count checked';
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert (select count(*) from public.activity_log where workspace_id = tests.id('acme') and entity = 'export'
          and action in ('export_summary', 'export_responses') and entity_id = tests.id('leads')) = 2, 'export rows logged';
  assert exists (select 1 from public.activity_log where action = 'export_responses' and diff ->> 'row_count' = '5'
                 and actor = tests.id('editor1')), 'row count and actor';
end $$;

-- 4. finish_import
select tests.as_user('editor1');
do $$
declare v_imp uuid;
begin
  insert into public.contact_imports (workspace_id, created_by) values (tests.id('acme'), tests.id('editor1')) returning id into v_imp;
  perform set_config('tests.imp', v_imp::text, true);
  perform public.import_contacts_chunk(v_imp, '[{"email": "a1@example.org"}, {"email": "nope"}]');
  assert tests.err(format('select public.finish_import(%L, %L)', v_imp, '{"status": "weird"}')) like 'Import status%', 'status checked';
  assert tests.err(format('select public.finish_import(%L, %L)', v_imp, '{"created": -1}')) like 'Import counts%', 'counts checked';
  perform public.finish_import(v_imp, '{"status": "done", "skipped": 4}');
  assert (select status = 'done' and finished_at is not null and created = 1 and invalid = 1 and skipped = 4
          from public.contact_imports where id = v_imp), 'import closed with counts';
  assert tests.err(format('select public.finish_import(%L, %L)', v_imp, '{}')) = 'import_finished', 'cannot finish twice';
end $$;
select tests.as_user('viewer1');
do $$ begin
  assert tests.err(format('select public.finish_import(%L, %L)', current_setting('tests.imp'), '{}')) = 'not_authorized',
    'viewer cannot finish imports';
end $$;

-- 5. admin_workspace_stats
select tests.as_user('pa');
do $$
declare r record;
begin
  select * into r from public.admin_workspace_stats() s where s.workspace_id = tests.id('acme');
  assert r.member_count = 4 and r.survey_count = 3 and r.response_count = 4 and r.owner_id = tests.id('owner'),
    format('stats: %s', row_to_json(r));
  assert (select count(*) from public.admin_workspace_stats()) >= 2, 'every workspace';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err('select * from public.admin_workspace_stats()') = 'not_authorized', 'platform admin only';
end $$;

-- 6. invite_preview
reset role;
select tests.clear_claims();
insert into public.workspace_invites (workspace_id, role, token, label) values
  (tests.id('acme'), 'editor', 'open-invite-token-0001', 'secret label'),
  (tests.id('acme'), 'viewer', 'revoked-invite-token-01', null),
  (tests.id('acme'), 'viewer', 'expired-invite-token-01', null);
update public.workspace_invites set revoked_at = now() where token = 'revoked-invite-token-01';
update public.workspace_invites set expires_at = now() - interval '1 minute' where token = 'expired-invite-token-01';
update public.workspaces set logo_path = 'acme/logo-1.png' where id = tests.id('acme');
select tests.as_user('outsider');
do $$
declare r record;
begin
  select * into r from public.invite_preview('open-invite-token-0001');
  assert r.workspace_name = 'acme' and r.logo_path = 'acme/logo-1.png' and r.role = 'editor', format('preview: %s', row_to_json(r));
  assert (select count(*) from public.invite_preview('revoked-invite-token-01')) = 0, 'revoked: nothing';
  assert (select count(*) from public.invite_preview('expired-invite-token-01')) = 0, 'expired: nothing';
  assert (select count(*) from public.invite_preview('no-such-token-000')) = 0, 'unknown: nothing';
  assert (select count(*) from public.invite_preview(null)) = 0, 'null: nothing';
end $$;

-- 7. workspace_members_with_email
select tests.as_user('admin1');
do $$ begin
  assert (select count(*) from public.workspace_members_with_email(tests.id('acme'))) = 4, 'all members';
  assert (select email from public.workspace_members_with_email(tests.id('acme')) m where m.user_id = tests.id('viewer1'))
         = 'viewer1@test.local', 'email joined from auth.users';
  assert tests.err($q$select * from public.workspace_members_with_email(tests.id('other'))$q$) = 'not_authorized', 'other workspace';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert tests.err($q$select * from public.workspace_members_with_email(tests.id('acme'))$q$) = 'not_authorized', 'editor refused';
end $$;

-- 8. pending_storage_deletions, including rows for a workspace that no longer exists
reset role;
select tests.clear_claims();
insert into public.storage_deletions (bucket, path, workspace_id, reason) values
  ('uploads', 'gone/a.pdf', '11111111-1111-4111-8111-111111111111', 'workspace_delete'),
  ('uploads', 'gone/b.pdf', '11111111-1111-4111-8111-111111111111', 'workspace_delete');
update public.storage_deletions set done_at = now() where path = 'gone/b.pdf';
select tests.as_service();
do $$ begin
  assert (select array_agg(path) from public.pending_storage_deletions('11111111-1111-4111-8111-111111111111')) = array['gone/a.pdf'],
    'undone rows of a purged workspace';
end $$;
select tests.as_user('pa');
do $$ begin
  assert tests.err($q$select * from public.pending_storage_deletions(gen_random_uuid())$q$) like '%permission denied%',
    'service role only';
end $$;

-- 9. platform admin writes audit themselves
reset role;
select tests.clear_claims();
insert into public.access_requests (user_id, name) values (tests.id('outsider'), 'Out Sider');
insert into public.workspace_requests (requested_by, department_name) values (tests.id('editor1'), 'Facilities');
insert into public.abuse_reports (slug_text, reason) values ('abcdefghij', 'phishing');
select tests.as_user('pa');
do $$
declare v_inv public.platform_invites; v_audit int;
begin
  select count(*) into v_audit from public.platform_audit_log;
  v_inv := public.admin_issue_platform_invite(' New.Person@Example.org ', 'hello', 7);
  assert v_inv.email = 'new.person@example.org' and v_inv.token is not null
     and v_inv.expires_at between now() + interval '6 days' and now() + interval '8 days', 'invite issued';
  assert tests.err($q$select public.admin_issue_platform_invite('new.person@example.org', null, 7)$q$) like '%duplicate key%',
    'one open invite per email';
  assert tests.err($q$select public.admin_issue_platform_invite('bad', null, 7)$q$) like 'Enter a valid email%', 'email checked';
  assert tests.err($q$select public.admin_issue_platform_invite(null, null, 0)$q$) like 'Invites expire%', 'expiry checked';
  perform public.admin_revoke_platform_invite(v_inv.id);
  assert tests.err(format('select public.admin_revoke_platform_invite(%L)', v_inv.id)) = 'invalid_state', 'revoke once';
  perform public.admin_update_privacy_notice('# Notice');
  assert (select privacy_notice_md from public.platform_settings) = '# Notice', 'notice saved';
  perform public.admin_set_abuse_report_status((select id from public.abuse_reports limit 1), 'actioned');
  assert (select status = 'actioned' and reviewed_by = tests.id('pa') from public.abuse_reports limit 1), 'abuse status';
  assert tests.err($q$select public.admin_set_abuse_report_status((select id from public.abuse_reports limit 1), 'nope')$q$)
         like 'Status must be%', 'abuse status checked';
  perform public.admin_dismiss_access_request((select id from public.access_requests where user_id = tests.id('outsider')));
  perform public.admin_dismiss_workspace_request((select id from public.workspace_requests where department_name = 'Facilities'));
  assert tests.err($q$select public.admin_dismiss_workspace_request((select id from public.workspace_requests where department_name = 'Facilities'))$q$)
         = 'invalid_state', 'dismiss once';
  assert (select count(*) from public.platform_audit_log) = v_audit + 6, 'six audit rows';
  assert (select array_agg(action order by id) from public.platform_audit_log where actor = tests.id('pa'))
         @> array['invite.create', 'invite.revoke', 'settings.privacy_notice', 'abuse_report.actioned',
                  'access_request.dismiss', 'workspace_request.dismiss'], 'audit actions';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$select public.admin_issue_platform_invite(null, null, 7)$q$) = 'not_authorized', 'invite: PA only';
  assert tests.err($q$select public.admin_update_privacy_notice('x')$q$) = 'not_authorized', 'notice: PA only';
  assert tests.err($q$select public.admin_set_abuse_report_status(gen_random_uuid(), 'open')$q$) = 'not_authorized', 'abuse: PA only';
  assert tests.err($q$select public.admin_dismiss_access_request(gen_random_uuid())$q$) = 'not_authorized', 'access: PA only';
end $$;

-- 10, 11, 12. Share password, gate, custom field filters, matrix labels
select tests.as_service();
do $$
declare v_res jsonb;
begin
  for i in 1..3 loop
    v_res := pg_temp.submit('pulse', '{"q_puls0001": {"r_1": "c_4", "r_2": "c_5"}}');
    assert (v_res ->> 'ok')::boolean, format('pulse submit: %s', v_res);
  end loop;
end $$;
select tests.as_user('editor1');
do $$
declare v_rep uuid; v_tok text; v_hash text;
begin
  v_hash := public.hash_share_password('secret-pw');
  assert v_hash like '$2a$%' and extensions.crypt('secret-pw', v_hash) = v_hash, 'bcrypt hash';
  assert tests.err($q$select public.hash_share_password('short')$q$) like 'Share passwords%', 'length checked';
  insert into public.reports (workspace_id, survey_id, name) values (tests.id('acme'), tests.id('pulse'), 'Pulse')
  returning id into v_rep;
  insert into public.report_widgets (report_id, workspace_id, position, question_key, chart_type)
  values (v_rep, tests.id('acme'), 0, 'q_puls0001', 'heat_table');
  insert into public.report_shares (report_id, workspace_id, password_hash) values (v_rep, tests.id('acme'), v_hash)
  returning token into v_tok;
  perform set_config('tests.tok', v_tok, true);
  perform set_config('tests.rep', v_rep::text, true);
  insert into public.report_shares (report_id, workspace_id, revoked_at) values (v_rep, tests.id('acme'), null)
  returning token into v_tok;
  update public.report_shares set revoked_at = now() where token = v_tok;
  perform set_config('tests.revoked', v_tok, true);
  assert tests.err($q$select * from public.report_share_gate('whatever-token')$q$) like '%permission denied%', 'gate: service only';
end $$;
select tests.as_service();
do $$
declare r record; v_payload jsonb; v_w jsonb;
begin
  select * into r from public.report_share_gate(current_setting('tests.tok'));
  assert r.status = 'needs_password' and r.report_id is null, 'no password';
  select * into r from public.report_share_gate(current_setting('tests.tok'), 'wrong-pw');
  assert r.status = 'needs_password', 'wrong password';
  select * into r from public.report_share_gate(current_setting('tests.revoked'));
  assert r.status = 'not_found', 'revoked';
  select * into r from public.report_share_gate('unknown-token-1234');
  assert r.status = 'not_found', 'unknown';
  select * into r from public.report_share_gate(current_setting('tests.tok'), 'secret-pw');
  assert r.status = 'open' and r.report_id = current_setting('tests.rep')::uuid, 'open with password';
  assert (select view_count = 1 and last_viewed_at is not null from public.report_shares
          where token = current_setting('tests.tok')), 'one view counted';
  v_payload := public.shared_report_payload(current_setting('tests.tok'), 'secret-pw');
  assert (select view_count from public.report_shares where token = current_setting('tests.tok')) = 1,
    'payload does not count a second view';
  v_w := v_payload -> 'widgets' -> 0;
  assert v_w -> 'rows' -> 0 = '{"id": "r_1", "label": "I have the tools I need to do my job"}', format('rows: %s', v_w -> 'rows');
  assert jsonb_array_length(v_w -> 'columns') = 5 and v_w -> 'columns' -> 4 ->> 'label' = 'Strongly agree', 'columns';
  assert (select (e ->> 'count')::int from jsonb_array_elements(v_w -> 'result' -> 'data') e
          where e ->> 'row_id' = 'r_1' and e ->> 'column_id' = 'c_4') = 3, 'heat cell count';
  assert position('score' in v_payload::text) = 0, 'no scores in the payload';
end $$;

-- Contact custom field filters on filtered_responses
reset role;
select tests.clear_claims();
insert into public.contact_field_defs (workspace_id, key, label, type, options)
values (tests.id('acme'), 'region', 'Region', 'select', '["north", "south"]'),
       (tests.id('acme'), 'notes', 'Notes', 'text', null);
select tests.as_service();
select pg_temp.submit('leads', jsonb_build_object('q_lead0001', 'N' || g, 'q_lead0002', 'L', 'q_lead0003', 'c' || g || '@example.org'))
from generate_series(1, 3) g;
reset role;
select tests.clear_claims();
update public.contacts set custom = '{"region": "north", "notes": "Prefers Email"}' where email = 'c1@example.org';
update public.contacts set custom = '{"region": "south"}' where email = 'c2@example.org';
select tests.as_user('viewer1');
do $$
declare f jsonb := '{"version": "all"}';
begin
  assert (select count(*) from public.filtered_responses(tests.id('leads'),
          f || '{"contact": {"custom": [{"key": "region", "value": "north"}]}}')) = 1, 'custom eq';
  assert (select count(*) from public.filtered_responses(tests.id('leads'),
          f || '{"contact": {"custom": [{"key": "notes", "op": "contains", "value": "email"}]}}')) = 1, 'custom contains';
  assert (select count(*) from public.filtered_responses(tests.id('leads'),
          f || '{"contact": {"custom": [{"key": "region", "value": "north"}, {"key": "notes", "op": "contains", "value": "phone"}]}}')) = 0,
    'every custom filter must match';
  assert (select count(*) from public.filtered_responses(tests.id('leads'), f || '{"contact": {"custom": []}}')) = 3,
    'empty custom list keeps identified responses';
  assert tests.err($q$select * from public.filtered_responses(tests.id('leads'), '{"contact": {"custom": [{"key": "region", "op": "gt", "value": 1}]}}')$q$)
         like 'Custom field filters%', 'op checked';
end $$;

-- 14. anonymize strips Other text from kept choice answers
select tests.as_service();
select pg_temp.submit('event', '{"q_evfb0001": 3, "q_evfb0003": 1, "q_evfb0002": {"ids": ["o_2"], "other": "Call me at 555"}}');
reset role;
select tests.clear_claims();
do $$
declare v_c uuid;
begin
  insert into public.contacts (workspace_id, email) values (tests.id('acme'), 'anon-me@example.org') returning id into v_c;
  update public.responses set contact_id = v_c
   where id = (select response_id from public.answers where value_json ->> 'other' = 'Call me at 555');
  perform set_config('tests.anon_contact', v_c::text, true);
end $$;
select tests.as_user('admin1');
select count(*) from public.erase_respondent(current_setting('tests.anon_contact')::uuid, 'anonymize');
reset role;
select tests.clear_claims();
do $$ begin
  assert not exists (select 1 from public.answers where value_json::text like '%555%'), 'other text removed';
  assert not exists (select 1 from public.responses where raw::text like '%555%'), 'other text not in raw';
  assert exists (select 1 from public.answers a join public.responses r on r.id = a.response_id
                 where r.anonymized_at is not null and a.question_key = 'q_evfb0002' and a.value_json = '["o_2"]'),
    'ids kept for aggregates';
end $$;

rollback;
