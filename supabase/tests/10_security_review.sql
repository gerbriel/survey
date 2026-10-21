-- Migration 0019 (security review, docs/07-security-review.md): S1 verified
-- email invite claims, S3 kill switch, S4 idempotency without the resume
-- secret, S5 report survey pinning, S7 invite visibility and log scrubbing,
-- S10 upload caps and attach size check, and the SQL Low list (L-3, L-5,
-- L-6, L-8, L-9, L-10, L-12, L-13, D-07, I6).
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

create or replace function pg_temp.call(p_action text, p_survey text, p_answers jsonb, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.submit_response(jsonb_build_object('action', p_action, 'survey_id', tests.id(p_survey),
    'survey_version_id', tests.id(p_survey || '_v1'), 'idempotency_key', gen_random_uuid(),
    'answers', p_answers, 'visible_keys', '[]'::jsonb, 'respondent_hash', 'rid-' || md5(random()::text)) || p_extra) $$;

create or replace function pg_temp.mint(p_survey text, p_key text, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select public.create_upload(jsonb_build_object('survey_id', tests.id(p_survey), 'survey_version_id', tests.id(p_survey || '_v1'),
    'question_key', p_key, 'name', 'cv.pdf', 'size', 1000, 'mime', 'application/pdf') || p_extra) $$;
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
select tests.published_survey('leads', tests.id('acme'), 'editor1');
select tests.published_survey('oleads', tests.id('other'), 'outsider');
select pg_temp.publish_template('event', tests.id('acme'), 'editor1', '00000000-0000-4000-8000-000000000002');

-- ===========================================================================
-- S1 (R18). Email match claims only a provider-verified email
-- ===========================================================================
insert into public.platform_invites (email) values ('jane@corp.example'), ('bob@corp.example'), ('carol@corp.example');

do $$
declare v_mallory uuid := gen_random_uuid(); v_bob uuid := gen_random_uuid(); v_tok uuid := gen_random_uuid();
        v_token text;
begin
  -- Password signup for an invited address, with a forged email_verified flag in user metadata.
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_mallory, 'Jane@corp.example', '{"email_verified": true, "full_name": "Mallory"}',
          '{"provider": "email", "providers": ["email"]}');
  insert into auth.identities (user_id, provider_id, provider, identity_data)
  values (v_mallory, v_mallory::text, 'email', jsonb_build_object('sub', v_mallory, 'email', 'jane@corp.example', 'email_verified', false));
  assert (select status from public.profiles where id = v_mallory) = 'pending', 'password signup stays pending';
  assert (select used_at is null and used_by is null from public.platform_invites where email = 'jane@corp.example'),
    'invite not consumed by an unverified email';
  perform tests.put('mallory', v_mallory);

  -- Google signup (GoTrue sets provider in app metadata; identities come after the user row).
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_bob, 'bob@corp.example', '{"email_verified": true, "full_name": "Bob"}',
          '{"provider": "google", "providers": ["google"]}');
  assert (select status from public.profiles where id = v_bob) = 'active', 'google verified email claims';
  assert (select used_by from public.platform_invites where email = 'bob@corp.example') = v_bob, 'invite used by bob';

  -- Token link still claims for a password signup, whatever the email.
  select token into v_token from public.platform_invites where email = 'carol@corp.example';
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_tok, 'someone@else.example', jsonb_build_object('platform_invite_token', v_token),
          '{"provider": "email", "providers": ["email"]}');
  assert (select status from public.profiles where id = v_tok) = 'active', 'token link claims';
end $$;

-- claim_pending_invite for the password user: still pending.
select tests.as_user('mallory');
do $$ begin
  assert public.claim_pending_invite() ->> 'status' = 'pending', 'sign-in claim still refuses the unverified email';
end $$;
reset role;
select tests.clear_claims();
-- A verified Google identity for the same address (identity linking) makes the claim valid.
insert into auth.identities (user_id, provider_id, provider, identity_data)
values (tests.id('mallory'), 'google-sub-1', 'google', '{"email": "jane@corp.example", "email_verified": true}');
select tests.as_user('mallory');
do $$ begin
  assert public.claim_pending_invite() ->> 'status' = 'activated', 'verified identity claims';
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert public.signup_verified_email(tests.id('owner')) is null, 'fixture users without a provider are unverified';
  assert not has_function_privilege('authenticated', 'public.signup_verified_email(uuid)', 'EXECUTE'), 'internal helper';
end $$;

-- ===========================================================================
-- S3 (R16). Kill switch defaults to off and filters custom_script and gtm by type
-- ===========================================================================
do $$ begin
  assert not (select raw_script_pixels_allowed from public.effective_limits(tests.id('acme'))), 'default is off';
end $$;
select tests.as_user('owner');
do $$ begin
  assert tests.err($q$insert into public.workspace_pixels (workspace_id, type, value, label)
                      values (tests.id('acme'), 'gtm', 'GTM-ABCD12', 'GTM')$q$) = 'raw_script_pixels_disabled', 'gtm blocked by default';
  assert tests.err($q$insert into public.workspace_pixels (workspace_id, type, value, label)
                      values (tests.id('acme'), 'custom_script', '<script>x()</script>', 'Raw')$q$) = 'raw_script_pixels_disabled',
    'custom_script blocked by default';
end $$;
select tests.as_user('pa');
select public.admin_set_workspace_limits(tests.id('acme'), '{"raw_script_pixels_allowed": true}', 'pilot with warning');
select tests.as_user('owner');
do $$ begin
  insert into public.workspace_pixels (workspace_id, type, value, label) values (tests.id('acme'), 'gtm', 'GTM-ABCD12', 'GTM');
  insert into public.workspace_pixels (workspace_id, type, value, label, parsed)
  values (tests.id('acme'), 'custom_script', '<script>x()</script>', 'Raw', '{"version": 1, "parts": []}');
  insert into public.workspace_pixels (workspace_id, type, value, label, parsed)
  values (tests.id('acme'), 'ga4', 'G-ABC123', 'GA', '{"script": "evil()"}');
end $$;
reset role;
select tests.clear_claims();
select set_config('tests.slug', (select slug from public.surveys where id = tests.id('leads')), true);
select tests.as_anon();
do $$
declare v jsonb;
begin
  select pixels into v from public.resolve_public_survey(current_setting('tests.slug'));
  assert (select count(*) from jsonb_array_elements(v) p where p ->> 'type' in ('gtm', 'custom_script')) = 2,
    format('allowed: script pixels served %s', v);
  assert (select p -> 'parsed' from jsonb_array_elements(v) p where p ->> 'type' = 'ga4') = 'null'::jsonb, 'ga4 never carries parsed';
  assert (select p -> 'parsed' from jsonb_array_elements(v) p where p ->> 'type' = 'custom_script') is not null, 'custom_script parsed kept';
end $$;
select tests.as_user('pa');
select public.admin_set_workspace_limits(tests.id('acme'), '{"raw_script_pixels_allowed": false}', 'switched off');
select tests.as_anon();
do $$
declare v jsonb;
begin
  select pixels into v from public.resolve_public_survey(current_setting('tests.slug'));
  assert jsonb_array_length(v) = 1 and v -> 0 ->> 'type' = 'ga4', format('off: only ga4 served %s', v);
end $$;
reset role;
select tests.clear_claims();
update public.workspace_limits set raw_script_pixels_allowed = null where workspace_id = tests.id('acme');
select tests.as_anon();
do $$
declare v jsonb;
begin
  select pixels into v from public.resolve_public_survey(current_setting('tests.slug'));
  assert jsonb_array_length(v) = 1 and v -> 0 ->> 'type' = 'ga4', 'null override means off';
end $$;
reset role;
select tests.clear_claims();
delete from public.workspace_pixels where workspace_id = tests.id('acme');
delete from public.workspace_limits where workspace_id = tests.id('acme');

-- ===========================================================================
-- S4. Idempotency replay never returns the resume secret
-- ===========================================================================
select tests.as_service();
do $$
declare v_key uuid := gen_random_uuid(); v_payload jsonb; v1 jsonb; v2 jsonb;
begin
  v_payload := jsonb_build_object('action', 'save', 'survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'),
    'idempotency_key', v_key, 'answers', '{}'::jsonb, 'visible_keys', '[]'::jsonb, 'respondent_hash', 'rid-s4');
  v1 := public.submit_response(v_payload);
  assert (v1 ->> 'ok')::boolean and v1 ? 'resume_token', format('first save returns the secret once: %s', v1);
  v2 := public.submit_response(v_payload);
  assert not (v2 ? 'resume_token'), format('replay has no secret: %s', v2);
  assert (v2 ->> 'replayed')::boolean and v2 ->> 'response_id' = v1 ->> 'response_id', 'replay is marked';
  assert position(v1 ->> 'resume_token' in v2::text) = 0, 'secret nowhere in the replay';
  perform set_config('tests.s4_key', v_key::text, true);
  perform set_config('tests.s4_secret', v1 ->> 'resume_token', true);
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert (select not (result ? 'resume_token') and position(current_setting('tests.s4_secret') in result::text) = 0
          from public.submission_idempotency where key = current_setting('tests.s4_key')::uuid), 'stored result has no secret';
end $$;

-- ===========================================================================
-- S5 and L-5. Reports stay on their workspace's surveys; created_by is the caller
-- ===========================================================================
select tests.as_user('editor1');
do $$
declare v_rep uuid;
begin
  insert into public.reports (workspace_id, survey_id, name, created_by)
  values (tests.id('acme'), tests.id('leads'), 'Mine', tests.id('owner')) returning id into v_rep;
  assert (select created_by from public.reports where id = v_rep) = tests.id('editor1'), 'created_by forced to the caller';
  assert tests.err(format('update public.reports set survey_id = %L, is_default = true where id = %L',
                          tests.id('oleads'), v_rep)) is not null, 'cross-workspace repoint refused';
  assert tests.err(format('update public.reports set survey_id = %L where id = %L', tests.id('event'), v_rep))
         like '%immutable%', 'survey_id immutable even inside the workspace';
  assert tests.err(format('update public.reports set created_by = %L where id = %L', tests.id('owner'), v_rep))
         like '%immutable%', 'created_by immutable';
  assert tests.err(format($q$insert into public.reports (workspace_id, survey_id, name) values (%L, %L, 'x')$q$,
                          tests.id('acme'), tests.id('oleads'))) is not null, 'insert with a foreign survey refused';
  update public.reports set name = 'Renamed' where id = v_rep;
  perform set_config('tests.report', v_rep::text, true);
end $$;

-- ===========================================================================
-- S7 and D-07. Invite visibility, server tokens, no secrets in activity_log
-- ===========================================================================
select tests.as_user('owner');
do $$
declare v_tok text; v_exp timestamptz;
begin
  insert into public.workspace_invites (workspace_id, role, token, expires_at, max_uses)
  values (tests.id('acme'), 'admin', 'aaaaaaaaaaaaaaaa', '2999-01-01', 5) returning token, expires_at into v_tok, v_exp;
  assert v_tok <> 'aaaaaaaaaaaaaaaa' and length(v_tok) >= 30, 'D-07: client token ignored';
  assert v_exp <= now() + interval '30 days', 'D-07: expiry clamped to 30 days';
  insert into public.workspace_invites (workspace_id, role, expires_at)
  values (tests.id('acme'), 'editor', now() + interval '1 day') returning expires_at into v_exp;
  assert v_exp = now() + interval '1 day', 'D-07: a 1 day choice is kept';
end $$;
select tests.as_user('admin1');
insert into public.workspace_invites (workspace_id, role) values (tests.id('acme'), 'viewer');
do $$ begin
  assert not exists (select 1 from public.workspace_invites where role = 'admin'), 'admin cannot see an owner-created admin invite';
  assert exists (select 1 from public.workspace_invites where role = 'editor'), 'admin sees an editor invite';
  assert exists (select 1 from public.workspace_invites where role = 'viewer'), 'admin sees own invite';
end $$;
select tests.as_user('owner');
do $$ begin
  assert (select count(*) from public.workspace_invites) = 3, 'owner sees every invite';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert (select count(*) from public.workspace_invites) = 0, 'editors see no invites';
  insert into public.report_shares (report_id, workspace_id, password_hash)
  values (current_setting('tests.report')::uuid, tests.id('acme'), public.hash_share_password('secret-pw'));
  -- L-3 and D-12: anything but bcrypt is refused
  assert tests.err(format($q$insert into public.report_shares (report_id, workspace_id, password_hash)
                             values (%L, %L, '$1$abcdefgh$0123456789012345678901')$q$,
                          current_setting('tests.report'), tests.id('acme'))) like 'Share passwords must%', 'md5-crypt refused';
  assert tests.err(format($q$insert into public.report_shares (report_id, workspace_id, password_hash)
                             values (%L, %L, 'plain')$q$,
                          current_setting('tests.report'), tests.id('acme'))) like 'Share passwords must%', 'plain refused';
end $$;
reset role;
select tests.clear_claims();
do $$ begin
  assert not exists (select 1 from public.activity_log l join public.workspace_invites i on l.diff::text like '%' || i.token || '%'),
    'activity_log never contains an invite token';
  assert not exists (select 1 from public.activity_log l join public.report_shares s on l.diff::text like '%' || s.token || '%'),
    'activity_log never contains a share token';
  assert not exists (select 1 from public.activity_log
                     where diff ? 'token' or diff ? 'password_hash' or diff::text like '%$2%$%'), 'no secret keys logged';
  assert exists (select 1 from public.activity_log where entity = 'invite' and action = 'create'), 'invites still logged';
end $$;

-- ===========================================================================
-- S10. Upload caps count pending files; bucket limits; attach checks the size
-- ===========================================================================
reset role;
select tests.clear_claims();
select set_config('survey.publishing', 'on', true);
insert into public.questions (survey_version_id, survey_id, workspace_id, question_key, page_index, position, type,
                              label, label_hash, config)
select tests.id(n || '_v1'), tests.id(n), s.workspace_id, 'q_file0001', 0, 100, 'file_upload', 'CV', 'h',
       '{"validation": {"max_files": 1}}'
from unnest(array['leads', 'oleads']) n join public.surveys s on s.id = tests.id(n);
select set_config('survey.publishing', 'off', true);
insert into public.workspace_limits (workspace_id, max_files_per_response, note) values (tests.id('other'), 3, 'test');
select tests.as_service();
do $$
declare v_res jsonb; v_hash text; v_up jsonb; i int;
begin
  -- per response cap (3 in 'other'): pending mints count
  v_res := pg_temp.call('save', 'oleads', '{}');
  v_hash := public.sha256_hex(v_res ->> 'resume_token');
  for i in 1..3 loop
    v_up := pg_temp.mint('oleads', 'q_file0001', jsonb_build_object('resume_token_hash', v_hash));
    assert (v_up ->> 'ok')::boolean, format('mint %s: %s', i, v_up);
  end loop;
  v_up := pg_temp.mint('oleads', 'q_file0001', jsonb_build_object('resume_token_hash', v_hash));
  assert v_up ->> 'code' = 'file_count', format('fourth pending upload refused: %s', v_up);

  -- per question cap (max_files 1 plus 3 replacements) under the default 20 per response
  v_res := pg_temp.call('save', 'leads', '{}');
  v_hash := public.sha256_hex(v_res ->> 'resume_token');
  for i in 1..4 loop
    v_up := pg_temp.mint('leads', 'q_file0001', jsonb_build_object('resume_token_hash', v_hash));
    assert (v_up ->> 'ok')::boolean, format('question mint %s: %s', i, v_up);
  end loop;
  v_up := pg_temp.mint('leads', 'q_file0001', jsonb_build_object('resume_token_hash', v_hash));
  assert v_up ->> 'code' = 'file_count', format('question cap: %s', v_up);
  perform set_config('tests.s10_hash', v_hash, true);
  perform set_config('tests.s10_file', (select id::text from public.response_files
                                         where pending_response_id = (v_res ->> 'response_id')::uuid
                                         order by created_at limit 1), true);
end $$;
reset role;
select tests.clear_claims();
-- the object uploaded is larger than declared
insert into storage.objects (bucket_id, name, metadata)
select 'response-files', object_path, '{"size": 5000, "mimetype": "application/pdf"}'
from public.response_files where id = current_setting('tests.s10_file')::uuid;
select tests.as_service();
do $$
declare v jsonb;
begin
  v := pg_temp.call('save', 'leads', '{}', jsonb_build_object('resume_token_hash', current_setting('tests.s10_hash'),
                                                             'file_ids', jsonb_build_array(current_setting('tests.s10_file'))));
  assert v ->> 'code' = 'validation_failed' and v -> 'field_errors' ->> 'q_file0001' = 'file_size',
    format('size mismatch refused at attach: %s', v);
end $$;
reset role;
select tests.clear_claims();
update storage.objects set metadata = '{"size": 1000, "mimetype": "application/pdf"}'
 where name = (select object_path from public.response_files where id = current_setting('tests.s10_file')::uuid);
select tests.as_service();
do $$
declare v jsonb;
begin
  v := pg_temp.call('save', 'leads', '{}', jsonb_build_object('resume_token_hash', current_setting('tests.s10_hash'),
                                                             'file_ids', jsonb_build_array(current_setting('tests.s10_file'))));
  assert (v ->> 'ok')::boolean, format('matching size attaches: %s', v);
end $$;
reset role;
select tests.clear_claims();
do $$
declare b record;
begin
  assert (select status from public.response_files where id = current_setting('tests.s10_file')::uuid) = 'attached', 'attached';
  select * into b from storage.buckets where id = 'response-files';
  assert b.file_size_limit = 26214400, format('bucket limit is the largest per-file size: %s', b.file_size_limit);
  assert (select bool_and(public.upload_mime_allowed(m)) from unnest(b.allowed_mime_types) m), 'bucket types are allowed types';
  assert cardinality(b.allowed_mime_types) = 13 and not ('image/svg+xml' = any (b.allowed_mime_types)), 'exact allowlist';
  insert into public.workspace_limits (workspace_id, max_file_bytes, note) values (tests.id('acme'), 52428800, 'big files');
  assert (select file_size_limit from storage.buckets where id = 'response-files') = 52428800, 'override raises the bucket limit';
  delete from public.workspace_limits where workspace_id = tests.id('acme');
  assert (select file_size_limit from storage.buckets where id = 'response-files') = 26214400, 'and back';
end $$;

-- ===========================================================================
-- L-5. Notes, field definitions, views, pixel acknowledgement
-- ===========================================================================
select tests.as_user('editor1');
do $$
declare v_c1 uuid; v_c2 uuid; v_note uuid; v_def uuid;
begin
  insert into public.contacts (workspace_id, email) values (tests.id('acme'), 'n1@example.org') returning id into v_c1;
  insert into public.contacts (workspace_id, email) values (tests.id('acme'), 'n2@example.org') returning id into v_c2;
  insert into public.contact_notes (workspace_id, contact_id, author, body) values (tests.id('acme'), v_c1, tests.id('editor1'), 'hi')
  returning id into v_note;
  assert tests.err(format('update public.contact_notes set contact_id = %L where id = %L', v_c2, v_note)) like '%immutable%',
    'note contact_id immutable';
  update public.contact_notes set body = 'edited' where id = v_note;
  insert into public.contact_field_defs (workspace_id, key, label, type) values (tests.id('acme'), 'region', 'Region', 'text')
  returning id into v_def;
  assert tests.err(format($q$update public.contact_field_defs set key = 'area' where id = %L$q$, v_def)) like '%immutable%', 'key immutable';
  assert tests.err(format($q$update public.contact_field_defs set type = 'number' where id = %L$q$, v_def)) like '%immutable%', 'type immutable';
  update public.contact_field_defs set label = 'Sales region' where id = v_def;
  perform set_config('tests.c1', v_c1::text, true);
end $$;
select tests.as_user('viewer1');
do $$
declare v_view uuid;
begin
  insert into public.contact_views (workspace_id, name, created_by) values (tests.id('acme'), 'Mine', tests.id('viewer1'))
  returning id into v_view;
  assert tests.err(format('update public.contact_views set shared = true where id = %L', v_view)) is not null,
    'viewer cannot publish a view';
  update public.contact_views set name = 'Still mine' where id = v_view;
end $$;
select tests.as_user('admin1');
do $$ begin
  update public.workspaces set pixel_notice_ack_by = tests.id('viewer1') where id = tests.id('acme');
  assert (select pixel_notice_ack_by from public.workspaces where id = tests.id('acme')) is null, 'ack_by not client writable';
  update public.workspaces set pixel_notice_ack_at = now() where id = tests.id('acme');
  assert (select pixel_notice_ack_by from public.workspaces where id = tests.id('acme')) = tests.id('admin1'), 'ack_by is the caller';
end $$;

-- ===========================================================================
-- L-6. Import paths stay under the workspace prefix
-- ===========================================================================
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format($q$insert into public.contact_imports (workspace_id, created_by, storage_path) values (%L, %L, %L)$q$,
                          tests.id('acme'), tests.id('editor1'), 'imports/' || tests.id('other') || '/x.csv')) like '%contact_imports_path_scoped%',
    'foreign prefix refused';
  assert tests.err(format($q$insert into public.contact_imports (workspace_id, created_by, storage_path) values (%L, %L, %L)$q$,
                          tests.id('acme'), tests.id('editor1'), tests.id('acme') || '/../x.csv')) like '%contact_imports_path_scoped%',
    'dot dot refused';
  insert into public.contact_imports (workspace_id, created_by, storage_path)
  values (tests.id('acme'), tests.id('editor1'), 'imports/' || tests.id('acme') || '/x.csv');
end $$;

-- ===========================================================================
-- L-8, L-9. Realtime publication and rate limit pruning
-- ===========================================================================
reset role;
select tests.clear_claims();
do $$ begin
  assert (select pubinsert and pubupdate and not pubdelete from pg_publication where pubname = 'supabase_realtime'),
    'responses publishes insert and update only';
  assert (select command like '%interval ''1 day''%' from cron.job where jobname = 'prune_rate_limits'), 'pruned after 1 day';
end $$;

-- ===========================================================================
-- L-10. Stale lock takeover bumps the revision
-- ===========================================================================
select tests.as_user('editor1');
do $$
declare v_s uuid; v_v uuid; r jsonb;
begin
  v_s := public.create_survey(tests.id('acme'), 'Locks', '00000000-0000-4000-8000-000000000003');
  select current_draft_version_id into v_v from public.surveys where id = v_s;
  r := public.take_draft_lock(v_v, false);
  perform set_config('tests.lock_v', v_v::text, true);
  perform set_config('tests.lock_rev', r ->> 'revision', true);
end $$;
reset role;
select tests.clear_claims();
update public.survey_versions set locked_at = now() - interval '16 minutes' where id = current_setting('tests.lock_v')::uuid;
select tests.as_user('admin1');
do $$
declare r jsonb;
begin
  r := public.take_draft_lock(current_setting('tests.lock_v')::uuid, false);
  assert (r ->> 'ok')::boolean and (r ->> 'revision')::int = current_setting('tests.lock_rev')::int + 1,
    format('stale takeover bumps revision: %s', r);
  r := public.take_draft_lock(current_setting('tests.lock_v')::uuid, false);
  assert (r ->> 'revision')::int = current_setting('tests.lock_rev')::int + 1, 'own relock does not bump';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format($q$select public.save_draft(%L, %s, '{"pages": []}')$q$,
                          current_setting('tests.lock_v'), current_setting('tests.lock_rev'))) = 'lock_lost', 'previous holder cannot save';
end $$;

-- ===========================================================================
-- L-13. Responses are deleted through delete_response()
-- ===========================================================================
select tests.as_service();
select pg_temp.call('complete', 'leads', '{"q_lead0003": "del@example.org"}');
reset role;
select tests.clear_claims();
select set_config('tests.del_resp', (select id::text from public.responses where survey_id = tests.id('leads') and status = 'complete'
                                      order by submitted_at desc limit 1), true);
select set_config('tests.del_count', (select complete_count::text from public.surveys where id = tests.id('leads')), true);
select tests.as_user('admin1');
do $$
declare v_n int;
begin
  with d as (delete from public.responses where id = current_setting('tests.del_resp')::uuid returning 1)
  select count(*) into v_n from d;
  assert v_n = 0, 'no direct delete policy';
end $$;
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format('select public.delete_response(%L)', current_setting('tests.del_resp'))) = 'not_authorized', 'editor refused';
end $$;
select tests.as_user('outsider');
do $$ begin
  assert tests.err(format('select public.delete_response(%L)', current_setting('tests.del_resp'))) = 'not_authorized', 'other workspace refused';
end $$;
select tests.as_user('admin1');
select public.delete_response(current_setting('tests.del_resp')::uuid);
reset role;
select tests.clear_claims();
do $$ begin
  assert not exists (select 1 from public.responses where id = current_setting('tests.del_resp')::uuid), 'deleted';
  assert (select complete_count from public.surveys where id = tests.id('leads')) = current_setting('tests.del_count')::int - 1,
    'complete_count decremented';
  assert exists (select 1 from public.activity_log where entity = 'response' and action = 'delete'
                 and entity_id = current_setting('tests.del_resp')::uuid and actor = tests.id('admin1')), 'deletion logged';
end $$;

-- ===========================================================================
-- I6. Shared report min and max need 3 answers holding the value
-- ===========================================================================
select tests.as_service();
select pg_temp.call('complete', 'event', jsonb_build_object('q_evfb0001', x, 'q_evfb0003', 1, 'q_evfb0002', '["o_1"]'::jsonb))
from unnest(array[1, 4, 4, 4, 5]) x;
select tests.as_user('editor1');
do $$
declare v_rep uuid; v_tok text;
begin
  insert into public.reports (workspace_id, survey_id, name) values (tests.id('acme'), tests.id('event'), 'Shared')
  returning id into v_rep;
  insert into public.report_widgets (report_id, workspace_id, position, question_key, chart_type)
  values (v_rep, tests.id('acme'), 0, 'q_evfb0001', 'stat');
  insert into public.report_shares (report_id, workspace_id) values (v_rep, tests.id('acme')) returning token into v_tok;
  perform set_config('tests.i6_token', v_tok, true);
end $$;
select tests.as_service();
do $$
declare v jsonb;
begin
  v := public.shared_report_payload(current_setting('tests.i6_token'), null) -> 'widgets' -> 0 -> 'result' -> 'data';
  assert v ->> 'mean' is not null, format('aggregate shown: %s', v);
  assert v -> 'min' = 'null'::jsonb and v -> 'max' = 'null'::jsonb, format('single-respondent extremes suppressed: %s', v);
  v := public.report_widget_data(tests.id('event'), '{}', 'q_evfb0001', null) -> 'data';
  assert (v ->> 'min')::numeric = 1 and (v ->> 'max')::numeric = 5, format('dashboard keeps min and max: %s', v);
end $$;

-- ===========================================================================
-- L-12. Erasure log keeps a salted hash
-- ===========================================================================
select tests.as_user('admin1');
select count(*) from public.erase_respondent(current_setting('tests.c1')::uuid, 'hard');
reset role;
select tests.clear_claims();
do $$
declare d jsonb;
begin
  select diff into d from public.activity_log where entity = 'contact' and action = 'erase'
     and entity_id = current_setting('tests.c1')::uuid;
  assert d ? 'email_hash' and not d ? 'email_sha256', format('salted key: %s', d);
  assert d ->> 'email_hash' <> public.sha256_hex('n1@example.org'), 'not the unsalted hash';
  assert d ->> 'email_hash' = public.erasure_email_hash('N1@example.org'), 'stable for the same address';
  assert not has_table_privilege('authenticated', 'public.internal_secrets', 'SELECT'), 'salt unreadable by clients';
  assert not has_function_privilege('authenticated', 'public.erasure_email_hash(text)', 'EXECUTE'), 'hash helper internal';
end $$;

rollback;
