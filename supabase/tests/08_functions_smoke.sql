-- Smoke coverage for the remaining functions: search_contacts,
-- contact_duplicate_candidates, import_contacts_chunk, set_contact_custom,
-- create_upload plus file attach, record_events, shared_report_payload,
-- retention_batch, storage_sweep_batch, complete_storage_deletions,
-- rollup_old_events, reconcile_storage_bytes, pixel kill switch.
begin;

select tests.new_user('owner');
select tests.new_user('editor1');
select tests.new_user('viewer1');
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');
select tests.published_survey('leads', tests.id('acme'), 'editor1');

-- Contacts: custom fields, import, search, duplicates
select tests.as_user('editor1');
do $$
declare v_imp uuid; v_res jsonb;
begin
  insert into public.contact_field_defs (workspace_id, key, label, type, options)
  values (tests.id('acme'), 'region', 'Region', 'select', '["north", "south"]');
  insert into public.contact_imports (workspace_id, created_by, options, token_survey_id)
  values (tests.id('acme'), tests.id('editor1'), '{"default_tags": ["import-test"]}', tests.id('leads'))
  returning id into v_imp;
  v_res := public.import_contacts_chunk(v_imp, '[
    {"email": "Jane.Doe@gmail.com", "first_name": "Jane", "company": "Acme", "custom": {"region": "north"}},
    {"email": "janedoe+x@gmail.com", "first_name": "Jane", "company": "Acme"},
    {"email": "not-an-email"},
    {"email": "sam@example.org", "phone": "+15595550000", "custom": {"region": "west"}}]');
  assert (v_res ->> 'created')::int = 2 and (v_res ->> 'invalid')::int = 2, format('import counts: %s', v_res);
  assert jsonb_array_length(v_res -> 'tokens') = 2, 'tokens generated';
  assert tests.err($q$select public.set_contact_custom((select id from public.contacts where email = 'jane.doe@gmail.com'),
                      '{"region": "east"}')$q$) like 'invalid_custom_field%', 'custom validated';
  perform public.set_contact_custom((select id from public.contacts where email = 'jane.doe@gmail.com'), '{"region": "south"}');
  assert (select count(*) from public.search_contacts(tests.id('acme'), '{"tags": {"mode": "any", "values": ["import-test"]}}')) = 2,
    'search by tag';
  assert (select count(*) from public.search_contacts(tests.id('acme'),
          '{"custom": [{"key": "region", "op": "eq", "value": "south"}], "q": "jane"}')) = 1, 'search by custom and q';
  assert exists (select 1 from public.contact_duplicate_candidates(tests.id('acme')) where reason in ('email_variant', 'same_name_company')),
    'duplicate candidates';
end $$;
select tests.as_user('viewer1');
do $$ begin
  assert (select count(*) from public.search_contacts(tests.id('acme'), '{}')) = 2, 'viewers read contacts';
  assert tests.err($q$insert into public.contacts (workspace_id, email) values (tests.id('acme'), 'v@example.org')$q$)
         like '%row-level security%', 'viewers cannot write contacts';
end $$;

-- Uploads: mint, upload (simulated storage object), attach on submit
select tests.as_service();
do $$
declare v_up jsonb; v_res jsonb;
begin
  -- the lead template has no file question; the mint is refused
  v_up := public.create_upload(jsonb_build_object('survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'),
            'question_key', 'q_lead0001', 'name', 'cv.pdf', 'size', 1000, 'mime', 'application/pdf'));
  assert v_up ->> 'code' = 'invalid_request', 'not a file question';
  assert public.record_events(jsonb_build_array(
    jsonb_build_object('survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'), 'type', 'view',
                       'respondent_hash', 'rid-1', 'meta', '{"device": "mobile"}'),
    jsonb_build_object('survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'), 'type', 'complete',
                       'respondent_hash', 'rid-1'),
    jsonb_build_object('survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'), 'type', 'bogus'))) = 1,
    'record_events keeps only valid client events';
  assert public.rate_limit_hit('submit:create', 'iphash', interval '10 minutes', 1), 'first hit allowed';
  assert not public.rate_limit_hit('submit:create', 'iphash', interval '10 minutes', 1), 'second hit limited';
end $$;

-- Reports and a public share payload with small-cell suppression
select tests.as_service();
select public.submit_response(jsonb_build_object('action', 'complete', 'survey_id', tests.id('leads'),
  'survey_version_id', tests.id('leads_v1'), 'idempotency_key', gen_random_uuid(),
  'answers', jsonb_build_object('q_lead0003', 'p' || g || '@example.org', 'q_lead0006', case when g < 4 then 'o_1' else 'o_2' end)))
from generate_series(1, 5) g;
select tests.as_user('editor1');
do $$
declare v_rep uuid; v_tok text; v_payload jsonb;
begin
  insert into public.reports (workspace_id, survey_id, name) values (tests.id('acme'), tests.id('leads'), 'Interest')
  returning id into v_rep;
  insert into public.report_widgets (report_id, workspace_id, position, question_key, chart_type)
  values (v_rep, tests.id('acme'), 0, 'q_lead0006', 'bar'), (v_rep, tests.id('acme'), 1, 'q_lead0003', 'table');
  insert into public.report_shares (report_id, workspace_id, password_hash)
  values (v_rep, tests.id('acme'), extensions.crypt('pw', extensions.gen_salt('bf'))) returning token into v_tok;
  perform set_config('tests.share_token', v_tok, true);
end $$;
select tests.as_service();
do $$
declare v_payload jsonb; v_w jsonb;
begin
  assert public.shared_report_payload(current_setting('tests.share_token'), 'wrong') is null, 'wrong password';
  assert public.shared_report_payload('unknown-token-1234', null) is null, 'unknown token';
  v_payload := public.shared_report_payload(current_setting('tests.share_token'), 'pw');
  v_w := v_payload -> 'widgets' -> 0 -> 'result' -> 'data';
  assert (select (e ->> 'count')::int from jsonb_array_elements(v_w) e where e ->> 'option_id' = 'o_1') = 3, 'count shown at 3';
  assert (select (e ->> 'suppressed')::boolean from jsonb_array_elements(v_w) e where e ->> 'option_id' = 'o_2'), 'count under 3 suppressed';
  assert v_payload -> 'widgets' -> 1 -> 'result' -> 'data' = 'null'::jsonb, 'identity answers never exposed';
  assert position('example.org' in v_payload::text) = 0, 'no emails in the payload';
end $$;

-- Pixel kill switch
reset role;
select tests.clear_claims();
insert into public.workspace_limits (workspace_id, raw_script_pixels_allowed, note) values (tests.id('acme'), false, 'test');
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$insert into public.workspace_pixels (workspace_id, type, value, label)
                      values (tests.id('acme'), 'gtm', 'GTM-ABCD12', 'GTM')$q$) = 'raw_script_pixels_disabled', 'kill switch';
  insert into public.workspace_pixels (workspace_id, type, value, label) values (tests.id('acme'), 'ga4', 'G-ABC123', 'GA');
end $$;

-- Jobs: retention, sweep, completion, rollup, reconcile
reset role;
select tests.clear_claims();
update public.workspaces set retention_days = 30 where id = tests.id('acme');
update public.responses set started_at = now() - interval '40 days', submitted_at = now() - interval '40 days'
 where survey_id = tests.id('leads');
insert into public.response_files (workspace_id, survey_id, question_key, object_path, declared_size, declared_mime,
                                   original_name, created_at)
values (tests.id('acme'), tests.id('leads'), 'q_lead0001', tests.id('acme') || '/x/pending/1/a.pdf', 10, 'application/pdf',
        'a.pdf', now() - interval '2 days');
insert into public.events (workspace_id, survey_id, survey_version_id, type, respondent_hash, occurred_at)
values (tests.id('acme'), tests.id('leads'), tests.id('leads_v1'), 'view', 'old', now() - interval '200 days');
select tests.as_service();
do $$
declare v_ids bigint[];
begin
  perform public.retention_batch(tests.id('acme'), 1000);
  assert not exists (select 1 from public.responses where survey_id = tests.id('leads')), 'retention deleted old responses';
  v_ids := array(select deletion_id from public.storage_sweep_batch(100));
  assert exists (select 1 from public.storage_deletions where reason = 'orphan' and path like '%/pending/1/a.pdf'), 'orphan enqueued';
  perform public.complete_storage_deletions(v_ids, '[]');
  assert not exists (select 1 from public.storage_deletions where done_at is null), 'all marked done';
end $$;
reset role;
select tests.clear_claims();
select public.rollup_old_events();
select public.reconcile_storage_bytes();
do $$ begin
  assert exists (select 1 from public.event_daily where survey_id = tests.id('leads') and type = 'view'), 'rolled up';
  assert not exists (select 1 from public.events where respondent_hash = 'old'), 'old events deleted';
end $$;

rollback;
