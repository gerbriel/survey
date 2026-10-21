-- 0012: rate_limit_hit, create_upload, submit_response (service role only).
-- Spec: docs/01-data-model.md sections 5, 6, 12; docs/02 sections 5 and 6;
-- docs/04 section 2.

-- Sliding window log (doc 02 section 5.2). true = allowed (and recorded).
create or replace function rate_limit_hit(p_bucket text, p_key text, p_window interval, p_max int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_bucket is null or p_key is null or length(p_bucket) > 64 or length(p_key) > 200
     or p_window is null or p_window <= interval '0' or p_window > interval '1 day'
     or p_max is null or p_max < 1 then
    raise exception 'invalid_rate_limit_arguments';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_key, 0));
  select count(*) into n from rate_limit_events
   where bucket = p_bucket and key = p_key and at > now() - p_window;
  if n >= p_max then
    return false;
  end if;
  insert into rate_limit_events (bucket, key) values (p_bucket, p_key);
  return true;
end $$;
grant execute on function rate_limit_hit(text, text, interval, int) to service_role;

-- Global upload MIME allowlist (doc 02 section 6). SVG and HTML never.
create or replace function upload_mime_allowed(p_mime text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select lower(coalesce(p_mime, '')) in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
$$;

-- Follow merged_into to the live survivor; null when the chain ends in a tombstone.
create or replace function follow_contact(p_contact_id uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid := p_contact_id;
  v_next   uuid;
  v_status text;
begin
  for i in 1..10 loop
    select merged_into, status into v_next, v_status from contacts where id = v_id;
    if v_status is null then
      return null;
    end if;
    if v_next is null then
      return case when v_status = 'active' then v_id end;
    end if;
    v_id := v_next;
  end loop;
  return null;
end $$;

-- Match a live contact by email, then contact_aliases.email, else create.
create or replace function find_or_create_contact_by_email(p_workspace_id uuid, p_email text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_email is null then
    return null;
  end if;
  select id into v_id from contacts
   where workspace_id = p_workspace_id and email = p_email and merged_into is null and status = 'active';
  if v_id is null then
    select follow_contact(contact_id) into v_id from contact_aliases
     where workspace_id = p_workspace_id and email = p_email order by merged_at desc limit 1;
  end if;
  if v_id is null then
    insert into contacts (workspace_id, email, source)
    values (p_workspace_id, p_email, p_source)
    on conflict (workspace_id, email) where email is not null and merged_into is null and status = 'active' do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from contacts
       where workspace_id = p_workspace_id and email = p_email and merged_into is null and status = 'active';
    end if;
  end if;
  return v_id;
end $$;

-- Response metadata keys standardized in docs/01 section 6. Anything else is dropped.
create or replace function sanitize_response_metadata(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end) e
  where (e.key = 'hidden' and jsonb_typeof(e.value) = 'object' and octet_length(e.value::text) <= 8192)
     or (e.key in ('utm_source','utm_medium','utm_campaign','utm_term','utm_content','referrer_host','locale','random_seed')
         and jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 255)
     or (e.key = 'user_agent' and jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 512)
     or (e.key = 'device' and e.value #>> '{}' in ('mobile','tablet','desktop'))
     or (e.key = 'pixel_consent' and jsonb_typeof(e.value) = 'object' and octet_length(e.value::text) <= 512);
$$;

-- One answer value to its typed row {value_text|value_number|value_date|value_json}.
-- Accepts doc 03's toAnswerRow output (an object holding only value_* keys) or
-- a raw value, cast by the question's storage column. Raises with an
-- ErrorCode-style message ('type', 'unknown_option', 'email', ...). Returns
-- null for an empty answer.
create or replace function answer_row(p_type text, p_options jsonb, p_config jsonb, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_col  text := question_storage_column(p_type);
  v_row  jsonb;
  v_text text; v_num numeric; v_date date; v_json jsonb;
  v_ids  text[];
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'object' and p_value <> '{}'::jsonb
     and not exists (select 1 from jsonb_object_keys(p_value) k
                     where k not in ('value_text','value_number','value_date','value_json')) then
    v_row := p_value;
  else
    v_row := jsonb_build_object(v_col, p_value);
  end if;

  if v_row ? 'value_text' and v_row -> 'value_text' <> 'null'::jsonb then
    if jsonb_typeof(v_row -> 'value_text') not in ('string', 'number') then raise exception 'type'; end if;
    v_text := v_row ->> 'value_text';
    if length(v_text) > 20000 then raise exception 'max_length'; end if;
  end if;
  if v_row ? 'value_number' and v_row -> 'value_number' <> 'null'::jsonb then
    v_num := case jsonb_typeof(v_row -> 'value_number')
               when 'number'  then (v_row ->> 'value_number')::numeric
               when 'boolean' then case when (v_row ->> 'value_number')::boolean then 1 else 0 end
               when 'string'  then (v_row ->> 'value_number')::numeric
             end;
    if v_num is null then raise exception 'type'; end if;
  end if;
  if v_row ? 'value_date' and v_row -> 'value_date' <> 'null'::jsonb then
    v_date := (v_row ->> 'value_date')::date;
  end if;
  if v_row ? 'value_json' and v_row -> 'value_json' <> 'null'::jsonb then
    v_json := v_row -> 'value_json';
    if octet_length(v_json::text) > 65536 then raise exception 'max_length'; end if;
  end if;

  select array_agg(o ->> 'id') into v_ids
    from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) o;
  if p_type in ('single_choice', 'dropdown') and v_text is not null and not (v_text = any (coalesce(v_ids, '{}'))) then
    raise exception 'unknown_option';
  end if;
  if p_type in ('multiple_choice', 'ranking') and v_json is not null then
    if jsonb_typeof(v_json) <> 'array' or exists (
         select 1 from jsonb_array_elements(v_json) e
         where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (coalesce(v_ids, '{}')))) then
      raise exception 'unknown_option';
    end if;
  end if;
  if p_type = 'matrix' and v_json is not null then
    if jsonb_typeof(v_json) <> 'object' or exists (
         select 1 from jsonb_each(v_json) e
         where not exists (select 1 from jsonb_array_elements(coalesce(p_config #> '{settings,rows}', '[]')) r where r ->> 'id' = e.key)
            or not exists (select 1 from jsonb_array_elements(coalesce(p_config #> '{settings,columns}', '[]')) c
                           where c ->> 'id' = e.value #>> '{}')) then
      raise exception 'unknown_option';
    end if;
  end if;
  if p_type = 'email' and v_text is not null then
    v_text := lower(btrim(v_text));
    if v_text <> '' and v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email'; end if;
  end if;
  if p_type in ('yes_no', 'consent') and v_num is not null and v_num not in (0, 1) then
    raise exception 'type';
  end if;
  if p_type = 'nps' and v_num is not null and (v_num < 0 or v_num > 10 or v_num <> trunc(v_num)) then
    raise exception 'type';
  end if;
  if p_type = 'address' and v_json is not null and jsonb_typeof(v_json) <> 'object' then
    raise exception 'type';
  end if;

  return jsonb_strip_nulls(jsonb_build_object('value_text', nullif(v_text, ''), 'value_number', v_num,
                                              'value_date', v_date, 'value_json', v_json));
end $$;

create or replace function answer_has_value(p_row jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_row is not null and (
       coalesce(p_row ->> 'value_text', '') <> ''
    or p_row ? 'value_number'
    or p_row ? 'value_date'
    or (p_row ? 'value_json' and p_row -> 'value_json' not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)));
$$;

-- ---------------------------------------------------------------------------
-- create_upload (doc 02 section 6). Payload: {survey_id, survey_version_id,
-- question_key, name, size, mime, resume_token_hash?}. Returns
-- {ok, file_id, object_path} or {ok:false, code}.
-- ---------------------------------------------------------------------------
create or replace function create_upload(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        surveys;
  w        workspaces;
  q        questions;
  st       record;
  l        record;
  v_sid    uuid; v_vid uuid;
  v_name   text := btrim(p_payload ->> 'name');
  v_size   bigint;
  v_mime   text := lower(btrim(p_payload ->> 'mime'));
  v_safe   text;
  v_ext    text;
  v_id     uuid := gen_random_uuid();
  v_path   text;
  v_resp   uuid;
  v_maxmb  numeric;
begin
  begin
    v_sid := (p_payload ->> 'survey_id')::uuid;
    v_vid := (p_payload ->> 'survey_version_id')::uuid;
    v_size := (p_payload ->> 'size')::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  if v_sid is null or v_vid is null or v_name is null or v_name = '' or length(v_name) > 255 or v_size is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into s from surveys where id = v_sid;
  select * into w from workspaces where id = s.workspace_id;
  if s.id is null or w.deleted_at is not null
     or not exists (select 1 from survey_versions where id = v_vid and survey_id = v_sid and status = 'published') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into st from survey_effective_state(s, w.archived_at is not null);
  if st.state <> 'open' then
    return jsonb_build_object('ok', false, 'code', case st.state when 'scheduled' then 'not_open_yet'
                                                                when 'draft' then 'not_found' else 'survey_closed' end);
  end if;
  select * into q from questions where survey_version_id = v_vid and question_key = p_payload ->> 'question_key';
  if q.id is null or q.type not in ('file_upload', 'signature') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into l from effective_limits(s.workspace_id);
  v_maxmb := (q.config #>> '{validation,max_file_mb}')::numeric;
  if v_size <= 0 or v_size > l.max_file_bytes
     or (v_maxmb is not null and v_size > v_maxmb * 1048576) then
    return jsonb_build_object('ok', false, 'code', 'file_size');
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{1,10})$'));
  if not upload_mime_allowed(v_mime)
     or (q.type = 'signature' and v_mime <> 'image/png')
     or (jsonb_typeof(q.config #> '{validation,allowed_extensions}') = 'array'
         and not exists (select 1 from jsonb_array_elements_text(q.config #> '{validation,allowed_extensions}') x
                         where lower(x) = v_ext)) then
    return jsonb_build_object('ok', false, 'code', 'file_type');
  end if;
  if nullif(p_payload ->> 'resume_token_hash', '') is not null then
    select id into v_resp from responses
     where resume_token_hash = p_payload ->> 'resume_token_hash' and survey_id = v_sid and status = 'partial';
    if v_resp is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    if (select count(*) from response_files where response_id = v_resp) >= l.max_files_per_response then
      return jsonb_build_object('ok', false, 'code', 'file_count');
    end if;
  end if;

  v_safe := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9._-]+', '-', 'g'), '-.'), 100);
  if v_safe = '' then v_safe := 'file'; end if;
  v_path := s.workspace_id || '/' || s.id || '/pending/' || v_id || '/' || v_safe;
  insert into response_files (id, workspace_id, survey_id, question_key, object_path, declared_size, declared_mime, original_name)
  values (v_id, s.workspace_id, s.id, q.question_key, v_path, v_size, v_mime, v_name);
  return jsonb_build_object('ok', true, 'file_id', v_id, 'object_path', v_path);
end $$;

-- ---------------------------------------------------------------------------
-- submit_response. Payload: action ('save'|'complete'), survey_id,
-- survey_version_id, idempotency_key, resume_token_hash?, respondent_token?,
-- respondent_hash, answers {question_key: value or toAnswerRow row},
-- visible_keys [], metadata {}, ip, file_ids [], started_at, last_question_key?.
-- Returns {ok, code?, response_id, resume_token?, score?, score_max?, field_errors?}.
-- The resume secret is returned once in plain text; only sha256_hex(secret) is
-- stored, and later calls pass that hash as resume_token_hash.
-- ---------------------------------------------------------------------------
create or replace function submit_response_core(p_payload jsonb, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s          surveys;
  w          workspaces;
  v          survey_versions;
  r          responses;
  tok        respondent_tokens;
  st         record;
  l          record;
  q          record;
  f          record;
  v_answers  jsonb := coalesce(p_payload -> 'answers', '{}'::jsonb);
  v_rows     jsonb := '{}';
  v_errors   jsonb := '{}';
  v_key      text;
  v_val      jsonb;
  v_row      jsonb;
  v_visible  text[];
  v_file_ids uuid[];
  v_obj      jsonb;
  v_started  timestamptz;
  v_secret   text;
  v_meta     jsonb := sanitize_response_metadata(p_payload -> 'metadata');
  v_rid      text := left(nullif(p_payload ->> 'respondent_hash', ''), 64);
  v_contact  uuid;
  v_source   text;
  v_email    text;
  v_phone    text;
  v_hidden   jsonb;
  v_score    numeric := 0;
  v_max      numeric := 0;
  v_scored   boolean := false;
  v_quizkey  text;
  v_ip       inet;
  v_n        int;
  v_custom   jsonb;
begin
  select * into s from surveys where id = (p_payload ->> 'survey_id')::uuid for update;
  select * into w from workspaces where id = s.workspace_id;
  if s.id is null or w.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v from survey_versions where id = (p_payload ->> 'survey_version_id')::uuid;
  if v.id is null or v.survey_id <> s.id or v.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Existing partial: by resume hash, else the token's open partial.
  if nullif(p_payload ->> 'resume_token_hash', '') is not null then
    select * into r from responses
     where resume_token_hash = p_payload ->> 'resume_token_hash' and survey_id = s.id for update;
    if r.id is null or r.status <> 'partial' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
  end if;
  if nullif(p_payload ->> 'respondent_token', '') is not null then
    select * into tok from respondent_tokens
     where token = p_payload ->> 'respondent_token' and survey_id = s.id for update;
    if tok.id is null or tok.revoked_at is not null or (tok.expires_at is not null and tok.expires_at <= now()) then
      return jsonb_build_object('ok', false, 'code', 'token_invalid');
    end if;
    if (select count(*) from responses where respondent_token_id = tok.id and status = 'complete') >= tok.max_responses then
      return jsonb_build_object('ok', false, 'code', 'token_used');
    end if;
    if r.id is null then
      select * into r from responses
       where respondent_token_id = tok.id and status = 'partial' and survey_version_id = v.id
       order by started_at desc limit 1 for update;
    elsif r.respondent_token_id is not null and r.respondent_token_id <> tok.id then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
  end if;
  if r.id is not null and r.survey_version_id <> v.id then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  begin
    v_started := (p_payload ->> 'started_at')::timestamptz;
  exception when others then
    v_started := null;
  end;
  if v_started is null or v_started > now() or v_started < now() - interval '30 days' then
    v_started := now();
  end if;
  v_started := coalesce(r.started_at, v_started);

  -- State under the survey row lock, with the 15 minute grace for scheduled closes.
  select * into st from survey_effective_state(s, w.archived_at is not null);
  if st.state = 'open' then
    null;
  elsif st.state = 'closed' and st.reason = 'schedule' and now() < s.closes_at + interval '15 minutes'
        and v_started < s.closes_at then
    null;
  elsif st.state = 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_open_yet');
  elsif st.state = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif st.reason = 'cap' then
    return jsonb_build_object('ok', false, 'code', 'cap_reached');
  else
    return jsonb_build_object('ok', false, 'code', 'survey_closed');
  end if;

  -- Answers: no unknown keys, values cast to the storage column.
  for v_key, v_val in select key, value from jsonb_each(v_answers) loop
    select * into q from questions where survey_version_id = v.id and question_key = v_key;
    if q.id is null then
      v_errors := v_errors || jsonb_build_object(v_key, 'unknown_question');
      continue;
    end if;
    if question_storage_column(q.type) = 'none' or q.type in ('file_upload', 'signature') then
      continue;   -- display blocks store nothing; file answers derive from file_ids
    end if;
    begin
      v_row := answer_row(q.type, q.options, q.config, v_val);
    exception when others then
      v_errors := v_errors || jsonb_build_object(v_key, case when sqlerrm ~ '^[a-z_]+$' then sqlerrm else 'type' end);
      continue;
    end;
    v_rows := v_rows || jsonb_build_object(v_key, coalesce(v_row, 'null'::jsonb));
  end loop;

  -- Files: same survey, pending or already on this response, a file question
  -- of this version, real size and MIME from storage.objects.
  begin
    v_file_ids := array(select (jsonb_array_elements_text(coalesce(p_payload -> 'file_ids', '[]'::jsonb)))::uuid);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  select * into l from effective_limits(s.workspace_id);
  for f in select rf.* from response_files rf where rf.id = any (v_file_ids) for update loop
    v_key := f.question_key;
    if f.survey_id <> s.id or (f.status = 'attached' and f.response_id is distinct from r.id)
       or not exists (select 1 from questions where survey_version_id = v.id and question_key = f.question_key
                      and type in ('file_upload', 'signature')) then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_unknown');
      continue;
    end if;
    select o.metadata into v_obj from storage.objects o where o.bucket_id = 'response-files' and o.name = f.object_path;
    if v_obj is null then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_unknown');
    elsif coalesce((v_obj ->> 'size')::bigint, 0) > l.max_file_bytes then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_size');
    elsif not upload_mime_allowed(v_obj ->> 'mimetype') then
      v_errors := v_errors || jsonb_build_object(v_key, 'file_type');
    end if;
  end loop;
  if (select count(*) from response_files where id = any (v_file_ids)) <> coalesce(cardinality(v_file_ids), 0) then
    v_errors := v_errors || jsonb_build_object('_files', 'file_unknown');
  end if;
  if (select count(distinct x) from (
        select id as x from response_files where id = any (v_file_ids)
        union select id from response_files where r.id is not null and response_id = r.id) t) > l.max_files_per_response then
    v_errors := v_errors || jsonb_build_object('_files', 'file_count');
  end if;

  -- Required, only against the logic-visible keys the route computed.
  if p_action = 'complete' then
    v_visible := array(select jsonb_array_elements_text(coalesce(p_payload -> 'visible_keys', '[]'::jsonb)));
    for q in select * from questions
              where survey_version_id = v.id and required and question_key = any (v_visible)
                and question_storage_column(type) <> 'none' loop
      if q.type in ('file_upload', 'signature') then
        if not exists (select 1 from response_files rf
                       where rf.question_key = q.question_key and rf.survey_id = s.id
                         and (rf.id = any (v_file_ids) or (r.id is not null and rf.response_id = r.id))) then
          v_errors := v_errors || jsonb_build_object(q.question_key, 'required');
        end if;
      elsif not answer_has_value(v_rows -> q.question_key) and not v_errors ? q.question_key then
        v_errors := v_errors || jsonb_build_object(q.question_key, 'required');
      end if;
    end loop;
  end if;
  if v_errors <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'validation_failed', 'field_errors', v_errors);
  end if;

  perform set_config('survey.internal', 'on', true);

  -- The only cap (R10).
  if p_action = 'complete' then
    update surveys set complete_count = complete_count + 1
     where id = s.id and (response_cap is null or complete_count < response_cap);
    if not found then
      perform set_config('survey.internal', 'off', true);
      return jsonb_build_object('ok', false, 'code', 'cap_reached');
    end if;
  end if;

  if r.id is null then
    insert into responses (workspace_id, survey_id, survey_version_id, status, respondent_token_id,
                           respondent_hash, started_at, metadata)
    values (s.workspace_id, s.id, v.id, 'partial', tok.id, v_rid, v_started, v_meta)
    returning * into r;
  else
    update responses set metadata = metadata || v_meta, respondent_hash = coalesce(v_rid, respondent_hash),
                         respondent_token_id = coalesce(respondent_token_id, tok.id)
     where id = r.id returning * into r;
  end if;

  -- Answers: save replaces the keys sent; complete replaces everything.
  if p_action = 'complete' then
    delete from answers where response_id = r.id;
  else
    delete from answers where response_id = r.id and question_key in (select jsonb_object_keys(v_rows));
  end if;
  insert into answers (response_id, workspace_id, survey_id, survey_version_id, question_key,
                       value_text, value_number, value_date, value_json)
  select r.id, s.workspace_id, s.id, v.id, e.key,
         e.value ->> 'value_text', (e.value ->> 'value_number')::numeric, (e.value ->> 'value_date')::date,
         e.value -> 'value_json'
  from jsonb_each(v_rows) e
  where answer_has_value(e.value);

  -- Attach files, then derive file answers from every attached file.
  update response_files rf
     set status = 'attached', response_id = r.id, attached_at = coalesce(rf.attached_at, now()),
         size_bytes = (o.metadata ->> 'size')::bigint, mime_type = o.metadata ->> 'mimetype'
    from storage.objects o
   where rf.id = any (v_file_ids) and o.bucket_id = 'response-files' and o.name = rf.object_path;
  delete from answers a using response_files rf
   where a.response_id = r.id and rf.response_id = r.id and a.question_key = rf.question_key;
  insert into answers (response_id, workspace_id, survey_id, survey_version_id, question_key, value_json)
  select r.id, s.workspace_id, s.id, v.id, rf.question_key,
         case when max(q2.type) = 'signature'
              then (jsonb_agg(jsonb_build_object('file_id', rf.id, 'path', rf.object_path, 'name', rf.original_name,
                                                 'size', rf.size_bytes, 'mime', rf.mime_type) order by rf.created_at desc)) -> 0
              else jsonb_agg(jsonb_build_object('file_id', rf.id, 'path', rf.object_path, 'name', rf.original_name,
                                                'size', rf.size_bytes, 'mime', rf.mime_type) order by rf.created_at) end
  from response_files rf
  join questions q2 on q2.survey_version_id = v.id and q2.question_key = rf.question_key
  where rf.response_id = r.id
  group by rf.question_key;

  if (p_payload ->> 'last_question_key') is not null
     and exists (select 1 from questions where survey_version_id = v.id and question_key = p_payload ->> 'last_question_key') then
    update responses set last_question_key = p_payload ->> 'last_question_key' where id = r.id;
  end if;

  if p_action = 'save' then
    if nullif(p_payload ->> 'resume_token_hash', '') is null then
      v_secret := gen_token(32);
      update responses set resume_token_hash = sha256_hex(v_secret) where id = r.id;
    end if;
    perform set_config('survey.internal', 'off', true);
    return jsonb_strip_nulls(jsonb_build_object('ok', true, 'response_id', r.id, 'resume_token', v_secret));
  end if;

  -- ---- complete: contact resolution (docs/04 section 2.1) ----
  v_email := v_rows -> coalesce(s.identity_question_key,
               v.definition -> 'questions' -> (v.definition #>> '{identity,email_question_id}') ->> 'question_key') ->> 'value_text';
  v_phone := v_rows -> coalesce(s.identity_phone_key,
               v.definition -> 'questions' -> (v.definition #>> '{identity,phone_question_id}') ->> 'question_key') ->> 'value_text';
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;
  if tok.id is not null then
    v_contact := follow_contact(tok.contact_id);
    if v_contact is not null then
      v_source := 'token';
      if v_email is not null and v_email is distinct from (select email from contacts where id = v_contact) then
        v_meta := v_meta || jsonb_build_object('alt_email', v_email);
      end if;
    end if;
  end if;
  if v_contact is null and v_email is not null then
    v_contact := find_or_create_contact_by_email(s.workspace_id, v_email, 'survey:' || s.id);
    v_source := 'identity_answer';
  end if;
  if v_contact is null and v_email is null and v_phone is not null then
    select count(*) into v_n from contacts
     where workspace_id = s.workspace_id and phone = v_phone and merged_into is null and status = 'active';
    if v_n = 1 then
      select id into v_contact from contacts
       where workspace_id = s.workspace_id and phone = v_phone and merged_into is null and status = 'active';
    elsif v_n = 0 then
      insert into contacts (workspace_id, phone, source) values (s.workspace_id, v_phone, 'survey:' || s.id)
      returning id into v_contact;
    end if;
    if v_contact is not null then v_source := 'identity_answer'; end if;
  end if;
  if v_contact is null and s.trust_hidden_identity then
    v_hidden := coalesce(r.metadata -> 'hidden', '{}'::jsonb);
    if (v_hidden ->> 'contact') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_contact := follow_contact(coalesce(
        (select id from contacts where id = (v_hidden ->> 'contact')::uuid and workspace_id = s.workspace_id),
        (select contact_id from contact_aliases where alias_id = (v_hidden ->> 'contact')::uuid and workspace_id = s.workspace_id)));
    end if;
    if v_contact is null and lower(btrim(v_hidden ->> 'email')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_contact := find_or_create_contact_by_email(s.workspace_id, lower(btrim(v_hidden ->> 'email')), 'survey:' || s.id);
    end if;
    if v_contact is not null then v_source := 'hidden_field'; end if;
  end if;

  if v_contact is not null then
    -- Question to contact mapping fills blank fields only.
    for q in select qq.question_key, qq.config -> 'contact_field' as cf from questions qq
              where qq.survey_version_id = v.id and qq.config ? 'contact_field' loop
      v_row := v_rows -> q.question_key;
      continue when not answer_has_value(v_row);
      if q.cf ->> 'kind' = 'core' and q.cf ->> 'field' in ('first_name', 'last_name', 'company', 'phone') then
        update contacts set
          first_name = case when q.cf ->> 'field' = 'first_name' then coalesce(first_name, v_row ->> 'value_text') else first_name end,
          last_name  = case when q.cf ->> 'field' = 'last_name'  then coalesce(last_name,  v_row ->> 'value_text') else last_name end,
          company    = case when q.cf ->> 'field' = 'company'    then coalesce(company,    v_row ->> 'value_text') else company end,
          phone      = case when q.cf ->> 'field' = 'phone'      then coalesce(phone,      v_row ->> 'value_text') else phone end
        where id = v_contact;
      elsif q.cf ->> 'kind' = 'custom' and q.cf ->> 'key' is not null then
        select custom into v_custom from contacts where id = v_contact;
        if not (v_custom ? (q.cf ->> 'key')) then
          begin
            v_custom := validate_contact_custom(s.workspace_id, jsonb_build_object(q.cf ->> 'key',
              coalesce(v_row -> 'value_text', v_row -> 'value_number', to_jsonb(v_row ->> 'value_date'), v_row -> 'value_json')));
            update contacts set custom = custom || v_custom where id = v_contact;
          exception when others then
            null;   -- incompatible value: the answer stays on the response only
          end;
        end if;
      end if;
    end loop;
    update contacts set response_count = response_count + 1, last_response_at = now() where id = v_contact;
  end if;

  -- Score from the server half of the definition (R9). A quiz score calc
  -- computed by the route's validator wins; option, yes/no and matrix column
  -- scores are summed here otherwise. score_max is the best possible sum.
  for q in select qq.type, qq.question_key, qq.config -> 'settings' as st2 from questions qq where qq.survey_version_id = v.id loop
    v_row := v_rows -> q.question_key;
    if q.type in ('single_choice', 'dropdown', 'multiple_choice', 'ranking')
       and exists (select 1 from jsonb_array_elements(coalesce(q.st2 -> 'options', '[]')) o where o ? 'score') then
      v_scored := true;
      if q.type = 'multiple_choice' then
        v_max := v_max + coalesce((select sum(greatest((o ->> 'score')::numeric, 0)) from jsonb_array_elements(q.st2 -> 'options') o), 0);
        v_score := v_score + coalesce((select sum((o ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'options') o
                                       where (o ->> 'id') in (select jsonb_array_elements_text(coalesce(v_row -> 'value_json', '[]')))), 0);
      elsif q.type in ('single_choice', 'dropdown') then
        v_max := v_max + coalesce((select max((o ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'options') o), 0);
        v_score := v_score + coalesce((select (o ->> 'score')::numeric from jsonb_array_elements(q.st2 -> 'options') o
                                       where o ->> 'id' = v_row ->> 'value_text' limit 1), 0);
      end if;
    elsif q.type = 'yes_no' and (q.st2 ? 'yes_score' or q.st2 ? 'no_score') then
      v_scored := true;
      v_max := v_max + greatest(coalesce((q.st2 ->> 'yes_score')::numeric, 0), coalesce((q.st2 ->> 'no_score')::numeric, 0));
      v_score := v_score + coalesce(case (v_row ->> 'value_number')::numeric
                                      when 1 then (q.st2 ->> 'yes_score')::numeric
                                      when 0 then (q.st2 ->> 'no_score')::numeric end, 0);
    elsif q.type = 'matrix'
          and exists (select 1 from jsonb_array_elements(coalesce(q.st2 -> 'columns', '[]')) c where c ? 'score') then
      v_scored := true;
      v_max := v_max + jsonb_array_length(coalesce(q.st2 -> 'rows', '[]'))
                       * coalesce((select max((c ->> 'score')::numeric) from jsonb_array_elements(q.st2 -> 'columns') c), 0);
      v_score := v_score + coalesce((select sum((c ->> 'score')::numeric)
                                     from jsonb_each(coalesce(v_row -> 'value_json', '{}')) a
                                     join jsonb_array_elements(q.st2 -> 'columns') c on c ->> 'id' = a.value #>> '{}'), 0);
    end if;
  end loop;
  v_quizkey := v.definition -> 'questions' -> (v.definition #>> '{settings,quiz,score_calc_id}') ->> 'question_key';
  if v_quizkey is not null and (v_rows -> v_quizkey) ? 'value_number' then
    v_score := (v_rows -> v_quizkey ->> 'value_number')::numeric;
    v_scored := true;
  end if;

  if w.store_ip and nullif(p_payload ->> 'ip', '') is not null then
    begin
      v_ip := (p_payload ->> 'ip')::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  update responses set
    status = 'complete', submitted_at = now(), contact_id = v_contact, identity_source = v_source,
    score = case when v_scored then v_score end, score_max = case when v_scored then v_max end,
    metadata = metadata || v_meta,
    raw = p_payload - 'ip' - 'resume_token_hash' - 'respondent_token',
    ip = v_ip, resume_token_hash = null
  where id = r.id;

  if tok.id is not null then
    update respondent_tokens set used_count = used_count + 1 where id = tok.id;
  end if;

  if v_rid is not null then
    update events set response_id = r.id where survey_id = s.id and respondent_hash = v_rid and response_id is null;
  end if;
  insert into events (workspace_id, survey_id, survey_version_id, response_id, respondent_hash, type)
  values (s.workspace_id, s.id, v.id, r.id, v_rid, 'complete');

  perform set_config('survey.internal', 'off', true);
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'response_id', r.id,
    'score', case when v_scored then v_score end, 'score_max', case when v_scored then v_max end));
end $$;

create or replace function submit_response(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
  v_sid    uuid;
  v_idem   uuid;
  v_prev   submission_idempotency;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  begin
    v_action := p_payload ->> 'action';
    v_sid := (p_payload ->> 'survey_id')::uuid;
    v_idem := (p_payload ->> 'idempotency_key')::uuid;
    perform (p_payload ->> 'survey_version_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  if v_action is null or v_action not in ('save', 'complete') or v_sid is null or v_idem is null
     or p_payload ->> 'survey_version_id' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not exists (select 1 from surveys where id = v_sid) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into submission_idempotency (key, survey_id) values (v_idem, v_sid) on conflict (key) do nothing;
  if not found then
    select * into v_prev from submission_idempotency where key = v_idem;
    if v_prev.survey_id <> v_sid or v_prev.result is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    return v_prev.result;
  end if;

  v_result := submit_response_core(p_payload, v_action);
  update submission_idempotency
     set result = v_result,
         response_id = case when v_result ->> 'response_id' is not null then (v_result ->> 'response_id')::uuid end
   where key = v_idem;
  return v_result;
end $$;

grant execute on function create_upload(jsonb), submit_response(jsonb) to service_role;
