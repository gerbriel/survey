-- submit_response: response_cap, complete_count, token single use, required
-- fields only against visible_keys, idempotency, save and resume, contact
-- resolution by identity answer. Runs as service_role like the route handler.
begin;

create or replace function pg_temp.payload(p_action text, p_survey text, p_answers jsonb, p_visible text[] default '{}',
                                           p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('action', p_action, 'survey_id', tests.id(p_survey),
                            'survey_version_id', tests.id(p_survey || '_v1'),
                            'idempotency_key', gen_random_uuid(), 'answers', p_answers,
                            'visible_keys', to_jsonb(p_visible), 'respondent_hash', 'rid-' || md5(random()::text),
                            'metadata', '{"device": "mobile", "evil": "dropped"}'::jsonb) || p_extra $$;
grant execute on all functions in schema pg_temp to service_role;

select tests.new_user('owner');
select tests.new_user('editor1');
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.published_survey('leads', tests.id('acme'), 'editor1');
update public.surveys set response_cap = 2 where id = tests.id('leads');

select tests.as_service();
do $$
declare
  v_full jsonb := '{"q_lead0001": "Ana", "q_lead0002": "Lopez", "q_lead0003": " Ana@Example.org ",
                    "q_lead0006": "o_2"}';
  v_vis  text[] := array['q_lead0001', 'q_lead0002', 'q_lead0003', 'q_lead0004', 'q_lead0006'];
  v_res  jsonb;
  v_p    jsonb;
begin
  -- Required fields are checked only against visible_keys
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', '{"q_lead0003": "x@example.org"}', v_vis));
  assert v_res ->> 'code' = 'validation_failed' and v_res -> 'field_errors' ? 'q_lead0001'
     and v_res -> 'field_errors' ? 'q_lead0002' and not (v_res -> 'field_errors' ? 'q_lead0004'), 'required visible fields';
  assert (select complete_count from public.surveys where id = tests.id('leads')) = 0, 'failed submit does not count';
  -- the same answers with those questions hidden by logic are fine
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', '{"q_lead0003": "solo@example.org"}',
                                                  array['q_lead0003']));
  assert (v_res ->> 'ok')::boolean, format('hidden required questions are not required: %s', v_res);
  assert (select complete_count from public.surveys where id = tests.id('leads')) = 1, 'complete_count incremented';

  -- Unknown keys and unknown option ids are refused
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_full || '{"q_zzzzzzzz": 1}', v_vis));
  assert v_res -> 'field_errors' ->> 'q_zzzzzzzz' = 'unknown_question', 'unknown key';
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_full || '{"q_lead0006": "o_99"}', v_vis));
  assert v_res -> 'field_errors' ->> 'q_lead0006' = 'unknown_option', 'unknown option id';

  -- Idempotency: the same key returns the stored result and does not count twice
  v_p := pg_temp.payload('complete', 'leads', v_full, v_vis);
  v_res := public.submit_response(v_p);
  assert (v_res ->> 'ok')::boolean, format('second complete: %s', v_res);
  assert public.submit_response(v_p) = v_res || '{"replayed": true}'::jsonb, 'idempotent replay (0019 S4: marked replayed)';
  assert (select complete_count from public.surveys where id = tests.id('leads')) = 2, 'count 2 after replay';

  -- Contact resolved from the identity answer, mapping fills blanks
  assert exists (select 1 from public.contacts where workspace_id = tests.id('acme') and email = 'ana@example.org'
                 and first_name = 'Ana' and last_name = 'Lopez' and response_count = 1), 'contact created';
  assert (select identity_source from public.responses where id = (v_res ->> 'response_id')::uuid) = 'identity_answer',
    'identity source';
  assert (select metadata from public.responses where id = (v_res ->> 'response_id')::uuid) = '{"device": "mobile"}'::jsonb,
    'metadata sanitized';

  -- Cap reached: refused, count unchanged, state unchanged
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_full, v_vis));
  assert v_res ->> 'code' = 'cap_reached', format('cap: %s', v_res);
  assert (select complete_count from public.surveys where id = tests.id('leads')) = 2, 'cap holds the count';
  assert (select state from public.surveys where id = tests.id('leads')) = 'open', 'cap does not change state';
end $$;

-- Public page shows closed with reason cap
reset role;
select tests.clear_claims();
do $$
declare r record;
begin
  select * into r from public.resolve_public_survey((select slug from public.surveys where id = tests.id('leads')));
  assert r.effective_state = 'closed' and r.state_reason = 'cap', 'resolve shows cap';
end $$;

-- Personalized token: single use
update public.surveys set response_cap = null where id = tests.id('leads');
insert into public.contacts (workspace_id, email, first_name) values (tests.id('acme'), 'tok@example.org', 'Tok');
select tests.put('tok_contact', (select id from public.contacts where email = 'tok@example.org'));
insert into public.respondent_tokens (workspace_id, survey_id, contact_id, token, max_responses)
values (tests.id('acme'), tests.id('leads'), tests.id('tok_contact'), 'token-single-use-123', 1);

select tests.as_service();
do $$
declare
  v_ans jsonb := '{"q_lead0001": "T", "q_lead0002": "K", "q_lead0003": "different@example.org"}';
  v_res jsonb;
begin
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_ans, '{}', '{"respondent_token": "nope-token-000"}'));
  assert v_res ->> 'code' = 'token_invalid', 'unknown token';
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_ans, '{}',
                                                  '{"respondent_token": "token-single-use-123"}'));
  assert (v_res ->> 'ok')::boolean, format('token complete: %s', v_res);
  assert (select contact_id from public.responses where id = (v_res ->> 'response_id')::uuid) = tests.id('tok_contact'),
    'token contact wins over identity email';
  assert (select metadata ->> 'alt_email' from public.responses where id = (v_res ->> 'response_id')::uuid)
         = 'different@example.org', 'alt_email recorded';
  assert (select used_count from public.respondent_tokens where token = 'token-single-use-123') = 1, 'token used';
  v_res := public.submit_response(pg_temp.payload('complete', 'leads', v_ans, '{}',
                                                  '{"respondent_token": "token-single-use-123"}'));
  assert v_res ->> 'code' = 'token_used', format('second use refused: %s', v_res);
end $$;

-- Save, resume, complete; partials never create contacts
select tests.as_service();
do $$
declare
  v_res  jsonb;
  v_res2 jsonb;
  v_hash text;
  v_id   uuid;
begin
  v_res := public.submit_response(pg_temp.payload('save', 'leads', '{"q_lead0001": "Pat", "q_lead0003": "pat@example.org"}'));
  assert (v_res ->> 'ok')::boolean and v_res ? 'resume_token', format('save returns a resume token: %s', v_res);
  v_id := (v_res ->> 'response_id')::uuid;
  v_hash := public.sha256_hex(v_res ->> 'resume_token');
  assert (select resume_token_hash from public.responses where id = v_id) = v_hash, 'only the hash is stored';
  assert not exists (select 1 from public.contacts where email = 'pat@example.org'), 'partial creates no contact';
  v_res2 := public.submit_response(pg_temp.payload('save', 'leads', '{"q_lead0002": "Lee"}', '{}',
                                                   jsonb_build_object('resume_token_hash', v_hash)));
  assert (v_res2 ->> 'response_id')::uuid = v_id and not (v_res2 ? 'resume_token'), 'resume updates the same response';
  assert (select count(*) from public.answers where response_id = v_id) = 3, 'save merges answers by key';
  v_res2 := public.submit_response(pg_temp.payload('complete', 'leads',
              '{"q_lead0001": "Pat", "q_lead0002": "Lee", "q_lead0003": "pat@example.org"}',
              array['q_lead0001', 'q_lead0002', 'q_lead0003'], jsonb_build_object('resume_token_hash', v_hash)));
  assert (v_res2 ->> 'response_id')::uuid = v_id, format('complete on the resumed response: %s', v_res2);
  assert (select status = 'complete' and resume_token_hash is null and submitted_at is not null
          from public.responses where id = v_id), 'completed and resume secret cleared';
  assert exists (select 1 from public.events where response_id = v_id and type = 'complete'), 'complete event';
end $$;

-- Closed survey refuses submissions
reset role;
select tests.clear_claims();
update public.surveys set state = 'closed' where id = tests.id('leads');
select tests.as_service();
do $$ begin
  assert public.submit_response(pg_temp.payload('complete', 'leads', '{}')) ->> 'code' = 'survey_closed', 'closed';
  assert public.submit_response('{"action": "complete"}') ->> 'code' = 'invalid_request', 'bad payload';
end $$;

rollback;
