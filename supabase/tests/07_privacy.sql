-- erase_respondent (anonymize keeps a tombstone; hard removes everything),
-- merge_contacts, export_respondent_data permissions.
begin;

create or replace function pg_temp.complete(p_email text, p_extra jsonb default '{}') returns uuid language sql as $$
  select (public.submit_response(jsonb_build_object(
    'action', 'complete', 'survey_id', tests.id('leads'), 'survey_version_id', tests.id('leads_v1'),
    'idempotency_key', gen_random_uuid(), 'respondent_hash', 'rid-' || p_email,
    'answers', jsonb_build_object('q_lead0001', 'First', 'q_lead0002', 'Last', 'q_lead0003', p_email,
                                  'q_lead0006', 'o_2', 'q_lead0007', 'free text about me') || p_extra,
    'metadata', '{"device": "desktop", "utm_source": "flyer", "user_agent": "UA"}'::jsonb)) ->> 'response_id')::uuid $$;
grant execute on all functions in schema pg_temp to service_role;

select tests.new_user('owner');
select tests.new_user('admin1');
select tests.new_user('editor1');
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('admin1'), 'admin');
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.published_survey('leads', tests.id('acme'), 'editor1');

select tests.as_service();
select tests.put('r_ana', pg_temp.complete('ana@example.org'));
select tests.put('r_bob', pg_temp.complete('bob@example.org'));
select tests.put('r_bob2', pg_temp.complete('bob2@example.org'));
reset role;
select tests.clear_claims();
select tests.put('ana', (select contact_id from public.responses where id = tests.id('r_ana')));
select tests.put('bob', (select contact_id from public.responses where id = tests.id('r_bob')));
select tests.put('bob2', (select contact_id from public.responses where id = tests.id('r_bob2')));
insert into public.contact_notes (workspace_id, contact_id, author, body)
values (tests.id('acme'), tests.id('ana'), tests.id('editor1'), 'Called Ana');

-- Merge: bob2 into bob
select tests.as_user('editor1');
do $$ begin
  perform public.merge_contacts(tests.id('bob'), array[tests.id('bob2')], jsonb_build_object('email', tests.id('bob2')));
  assert (select merged_into from public.contacts where id = tests.id('bob2')) = tests.id('bob'), 'loser points at survivor';
  assert (select email from public.contacts where id = tests.id('bob')) = 'bob2@example.org', 'field choice applied';
  assert (select contact_id from public.responses where id = tests.id('r_bob2')) = tests.id('bob'), 'responses moved';
  assert (select response_count from public.contacts where id = tests.id('bob')) = 2, 'counters recomputed';
  assert exists (select 1 from public.contact_aliases where alias_id = tests.id('bob2') and email = 'bob2@example.org'),
    'alias kept';
  -- export: editor and above
  assert jsonb_array_length(public.export_respondent_data(tests.id('bob2')) -> 'responses') = 2, 'export follows alias';
  -- erase: admin only
  assert tests.err($q$select * from public.erase_respondent(tests.id('ana'), 'anonymize')$q$) = 'not_authorized',
    'editor cannot erase';
end $$;

-- Anonymize keeps the response and a tombstone contact
select tests.as_user('admin1');
do $$
declare v_count int;
begin
  select count(*) into v_count from public.erase_respondent(tests.id('ana'), 'anonymize');
  assert exists (select 1 from public.contacts where id = tests.id('ana') and status = 'deleted' and deleted_at is not null
                 and email is null and first_name is null and last_name is null and lead_status = 'lost'
                 and tags = '{}' and custom = '{}'), 'tombstone contact kept';
  assert (select contact_id from public.responses where id = tests.id('r_ana')) = tests.id('ana'),
    'response still points at the tombstone';
  assert (select metadata from public.responses where id = tests.id('r_ana'))
         = '{"device": "desktop", "utm_source": "flyer"}'::jsonb, 'metadata stripped to device and utm';
  assert (select respondent_hash is null and anonymized_at is not null from public.responses where id = tests.id('r_ana')),
    'rid nulled';
  assert not exists (select 1 from public.answers where response_id = tests.id('r_ana')
                     and question_key in ('q_lead0001', 'q_lead0002', 'q_lead0003', 'q_lead0007')),
    'identity, mapped and open text answers deleted';
  assert exists (select 1 from public.answers where response_id = tests.id('r_ana') and question_key = 'q_lead0006'),
    'choice answer kept for aggregates';
  assert not exists (select 1 from public.contact_notes where contact_id = tests.id('ana')), 'notes deleted';
  assert not exists (select 1 from public.activity_log where entity = 'contact' and entity_id = tests.id('ana')
                     and action <> 'erase' and diff <> '{"redacted": true}'::jsonb), 'activity redacted';
  assert exists (select 1 from public.activity_log where entity = 'contact' and entity_id = tests.id('ana')
                 and action = 'erase' and diff ->> 'mode' = 'anonymize'), 'erase logged';
  assert tests.err($q$update public.contacts set first_name = 'Back' where id = tests.id('ana')$q$)
         like 'Tombstoned and merged contacts are read only%', 'tombstone is read only';
end $$;

-- Hard delete removes the contact, the merged loser, and their responses
select tests.as_user('admin1');
do $$ begin
  perform public.erase_respondent(tests.id('bob2'), 'hard');   -- alias id resolves to the survivor
  assert not exists (select 1 from public.contacts where id in (tests.id('bob'), tests.id('bob2'))), 'contacts gone';
  assert not exists (select 1 from public.responses where id in (tests.id('r_bob'), tests.id('r_bob2'))), 'responses gone';
  assert not exists (select 1 from public.contact_aliases where alias_id = tests.id('bob2')), 'aliases gone';
end $$;

rollback;
