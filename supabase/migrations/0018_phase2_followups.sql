-- 0018: SQL follow-ups requested by the Phase 2 modules (docs/06-build-plan.md
-- "Running notes", entries 2A to 2E). Spec: docs/01-data-model.md sections 12
-- and 15 ("Migration 0018").
--
-- Every new function is SECURITY DEFINER with search_path = public, pg_temp,
-- checks its caller and its input, and is granted explicitly. 0001 already
-- revokes execute on new functions from public and anon by default; each
-- function below still revokes from public once more so the grant list is
-- the whole story. Input errors that have no SQL_ERROR_CODES entry are raised
-- as sentences with SQLSTATE 22023, which src/lib/db/errors.ts maps to
-- invalid_value.

-- ===========================================================================
-- 1. multiple_choice answers with "Other" text (Phase 2C)
-- ===========================================================================

-- Phase 2C. Option ids of a multiple_choice value_json, which is either a
-- plain array of ids or {ids, other} when the respondent typed Other text.
-- Ranking arrays pass through. Anything else yields [].
create or replace function multi_choice_ids(p_json jsonb) returns jsonb
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
           when jsonb_typeof(p_json) = 'array' then p_json
           when jsonb_typeof(p_json) = 'object' and jsonb_typeof(p_json -> 'ids') = 'array' then p_json -> 'ids'
           else '[]'::jsonb
         end;
$$;
revoke all on function multi_choice_ids(jsonb) from public;
grant execute on function multi_choice_ids(jsonb) to authenticated, service_role;

-- Phase 2C. answer_row from 0012, extended for doc 03's "Other" shapes:
--   multiple_choice  [ids] or {ids, other}; stored as value_json [ids] when the
--                    Other text is blank, else value_json {ids, other}
--   single_choice,   "id" or {id, other}; stored as value_text id plus
--   dropdown         value_json {other} when Other text is present
-- Unknown option ids are still refused with unknown_option.
create or replace function answer_row(p_type text, p_options jsonb, p_config jsonb, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_col   text := question_storage_column(p_type);
  v_row   jsonb;
  v_text  text; v_num numeric; v_date date; v_json jsonb;
  v_ids   text[];
  v_arr   jsonb;
  v_other text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'object' and p_value <> '{}'::jsonb
     and not exists (select 1 from jsonb_object_keys(p_value) k
                     where k not in ('value_text','value_number','value_date','value_json')) then
    v_row := p_value;
  elsif p_type in ('single_choice', 'dropdown') and jsonb_typeof(p_value) = 'object' and p_value ? 'id' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('id', 'other')) then
      raise exception 'type';
    end if;
    v_row := jsonb_build_object('value_text', p_value -> 'id',
                                'value_json', case when p_value ? 'other' then jsonb_build_object('other', p_value -> 'other') end);
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

  -- "Other" text: a string, trimmed; blank means no Other text.
  if p_type in ('single_choice', 'dropdown', 'multiple_choice') and jsonb_typeof(v_json) = 'object' then
    if exists (select 1 from jsonb_object_keys(v_json) k
               where k not in (case when p_type = 'multiple_choice' then 'ids' else 'other' end, 'other'))
       or (v_json ? 'other' and jsonb_typeof(v_json -> 'other') not in ('string', 'null'))
       or (p_type = 'multiple_choice' and jsonb_typeof(v_json -> 'ids') is distinct from 'array') then
      raise exception 'type';
    end if;
    v_other := nullif(btrim(coalesce(v_json ->> 'other', '')), '');
    if length(v_other) > 20000 then raise exception 'max_length'; end if;
    if p_type = 'multiple_choice' then
      v_json := case when v_other is null then v_json -> 'ids'
                     else jsonb_build_object('ids', v_json -> 'ids', 'other', v_other) end;
    else
      v_json := case when v_other is null then null else jsonb_build_object('other', v_other) end;
    end if;
  end if;

  select array_agg(o ->> 'id') into v_ids
    from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) o;
  if p_type in ('single_choice', 'dropdown') then
    if v_text is not null and not (v_text = any (coalesce(v_ids, '{}'))) then
      raise exception 'unknown_option';
    end if;
    if v_json is not null and jsonb_typeof(v_json) <> 'object' then
      raise exception 'type';
    end if;
  end if;
  if p_type in ('multiple_choice', 'ranking') and v_json is not null then
    v_arr := case when p_type = 'multiple_choice' and jsonb_typeof(v_json) = 'object' then v_json -> 'ids' else v_json end;
    if jsonb_typeof(v_arr) <> 'array' or exists (
         select 1 from jsonb_array_elements(v_arr) e
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

-- ===========================================================================
-- 1b. Readers of multiple_choice value_json (Phase 2C)
-- ===========================================================================

-- Phase 2C. submit_response_core from 0012 with two changes for the {ids, other}
-- shape: the option score sum and the contact custom field mapping read
-- option ids through multi_choice_ids. Everything else is unchanged.
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
    for q in select qq.question_key, qq.type, qq.config -> 'contact_field' as cf from questions qq
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
              coalesce(v_row -> 'value_text', v_row -> 'value_number', to_jsonb(v_row ->> 'value_date'),
                       case when q.type = 'multiple_choice' then multi_choice_ids(v_row -> 'value_json') else v_row -> 'value_json' end)));
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
                                       where (o ->> 'id') in (select jsonb_array_elements_text(multi_choice_ids(v_row -> 'value_json')))), 0);
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

-- Phase 2C. report_widget_data from 0013; multiple_choice counts read option
-- ids through multi_choice_ids so {ids, other} answers are counted.
create or replace function report_widget_data(p_survey_id uuid, p_filters jsonb, p_question_key text, p_metric text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  q      questions;
  v_type text;
  v_n    int;
  v_out  jsonb;
begin
  if p_question_key is null then
    -- funnel metric over the latest published version (event counts only)
    select jsonb_build_object(
             'views',     count(distinct e.respondent_hash) filter (where e.type = 'view'),
             'starts',    count(distinct e.respondent_hash) filter (where e.type = 'start'),
             'completes', count(*) filter (where e.type = 'complete'))
      into v_out
      from events e join surveys s on s.id = e.survey_id
     where e.survey_id = p_survey_id and e.survey_version_id = s.latest_published_version_id;
    return jsonb_build_object('metric', p_metric, 'funnel', v_out);
  end if;

  select qq.* into q from questions qq join surveys s on s.id = qq.survey_id
   where qq.survey_id = p_survey_id and qq.question_key = p_question_key
   order by (qq.survey_version_id = s.latest_published_version_id) desc, qq.position
   limit 1;
  v_type := q.type;
  create temporary table if not exists pg_temp.rw_answers (value_text text, value_number numeric, value_json jsonb) on commit drop;
  truncate pg_temp.rw_answers;
  insert into pg_temp.rw_answers
  select a.value_text, a.value_number, a.value_json
  from answers a join filtered_responses(p_survey_id, p_filters) r on r.id = a.response_id
  where a.question_key = p_question_key;
  select count(*) into v_n from pg_temp.rw_answers;

  if v_type in ('single_choice', 'dropdown') then
    select coalesce(jsonb_agg(jsonb_build_object('option_id', k, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3) order by n desc), '[]') into v_out
      from (select value_text as k, count(*) as n from pg_temp.rw_answers group by value_text) t;
  elsif v_type in ('multiple_choice', 'ranking') then
    select coalesce(jsonb_agg(jsonb_build_object('option_id', k, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3,
                                                 'avg_position', case when v_type = 'ranking' and n >= 3 then avg_pos end)
                              order by n desc), '[]') into v_out
      from (select e.value as k, count(*) as n, round(avg(e.ordinality), 2) as avg_pos
              from pg_temp.rw_answers a, jsonb_array_elements_text(multi_choice_ids(a.value_json)) with ordinality e
             group by e.value) t;
  elsif v_type = 'matrix' then
    select coalesce(jsonb_agg(jsonb_build_object('row_id', rk, 'column_id', ck, 'count', case when n >= 3 then n end,
                                                 'suppressed', n < 3)), '[]') into v_out
      from (select e.key as rk, e.value #>> '{}' as ck, count(*) as n
              from pg_temp.rw_answers a, jsonb_each(a.value_json) e group by 1, 2) t;
  elsif v_type in ('number', 'rating', 'nps', 'yes_no', 'consent', 'calculated') then
    if v_n < 3 then
      v_out := jsonb_build_object('suppressed', true);
    else
      select jsonb_build_object(
               'mean', round(avg(value_number), 2),
               'median', percentile_cont(0.5) within group (order by value_number),
               'min', min(value_number), 'max', max(value_number),
               'distribution', case when v_type in ('rating', 'nps', 'yes_no', 'consent') then (
                  select jsonb_agg(jsonb_build_object('value', x, 'count', case when c >= 3 then c end, 'suppressed', c < 3) order by x)
                  from (select value_number as x, count(*) as c from pg_temp.rw_answers group by value_number) d) end,
               'nps', case when v_type = 'nps' then round(100.0 * (count(*) filter (where value_number >= 9)
                                                         - count(*) filter (where value_number <= 6)) / nullif(count(*), 0)) end)
        into v_out from pg_temp.rw_answers where value_number is not null;
    end if;
  elsif v_type in ('short_text', 'long_text') then
    select coalesce(jsonb_agg(jsonb_build_object('word', wd, 'count', n) order by n desc, wd), '[]') into v_out
      from (select wd, count(*) as n
              from pg_temp.rw_answers a, regexp_split_to_table(lower(a.value_text), '[^[:alnum:]'']+') wd
             where length(wd) > 2 and wd not in (select word from stopwords where lang = 'en')
             group by wd having count(*) >= 3 order by n desc limit 50) t;
  else
    v_out := null;   -- identity, contact, file and free-form types: count only
  end if;
  return jsonb_build_object('n', case when v_n >= 3 then v_n end, 'suppressed', v_n < 3, 'type', v_type, 'data', v_out);
end $$;

-- Phase 2C follow-on (privacy). erase_respondent from 0014; anonymize now also
-- strips "Other" free text from kept choice answers, since it is open text.
create or replace function erase_respondent(p_contact_id uuid, p_mode text)
returns table (deletion_id bigint, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      uuid;
  c         contacts;
  v_all     uuid[];
  v_resp    uuid[];
  v_files   int;
  v_answers int := 0;
  v_keep    text[] := array['single_choice','dropdown','multiple_choice','yes_no','rating','nps','matrix',
                            'ranking','date','number','consent','calculated','time'];
begin
  if p_mode is null or p_mode not in ('hard', 'anonymize') then
    raise exception 'invalid_mode';
  end if;
  v_id := coalesce((select a.contact_id from contact_aliases a where a.alias_id = p_contact_id), p_contact_id);
  for i in 1..10 loop
    select * into c from contacts where id = v_id;
    exit when c.id is null or c.merged_into is null;
    v_id := c.merged_into;
  end loop;
  if c.id is null or not is_member(c.workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  v_all := contact_family(c.id);
  v_resp := array(select r.id from responses r where r.contact_id = any (v_all));
  select count(*) into v_files from response_files f where f.response_id = any (v_resp);

  perform set_config('survey.internal', 'on', true);
  perform set_config('survey.skip_log', 'on', true);
  perform set_config('survey.deletion_reason', 'erase', true);

  if p_mode = 'hard' then
    delete from events e where e.response_id = any (v_resp);
    delete from responses r where r.id = any (v_resp);      -- answers and file rows cascade, files enqueue
    delete from respondent_tokens t where t.contact_id = any (v_all);
    delete from contact_aliases a where a.contact_id = any (v_all) or a.alias_id = any (v_all);
    delete from contact_notes n where n.contact_id = any (v_all);
    delete from contacts x where x.id = any (v_all);
  else
    delete from response_files f where f.response_id = any (v_resp);
    with del as (
      delete from answers a
       using responses r, surveys s, questions q
       where a.response_id = r.id and r.id = any (v_resp) and s.id = r.survey_id
         and q.survey_version_id = r.survey_version_id and q.question_key = a.question_key
         and (not (q.type = any (v_keep)) or q.is_pii or q.config ? 'contact_field'
              or a.question_key = s.identity_question_key or a.question_key = s.identity_phone_key)
      returning 1)
    select count(*) into v_answers from del;
    -- answers whose question is missing from the snapshot are dropped too
    delete from answers a where a.response_id = any (v_resp)
       and not exists (select 1 from questions q join responses r on r.id = a.response_id
                       where q.survey_version_id = r.survey_version_id and q.question_key = a.question_key);
    -- "Other" free text on kept choice answers is open text: drop it, keep the ids.
    update answers a
       set value_json = case when jsonb_typeof(a.value_json -> 'ids') = 'array' then a.value_json -> 'ids' end
      from responses r, questions q
     where a.response_id = r.id and r.id = any (v_resp)
       and q.survey_version_id = r.survey_version_id and q.question_key = a.question_key
       and q.type in ('single_choice', 'dropdown', 'multiple_choice')
       and jsonb_typeof(a.value_json) = 'object' and a.value_json ? 'other';
    update responses r set
      ip = null, respondent_hash = null, resume_token_hash = null, anonymized_at = now(),
      metadata = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(r.metadata) e
                   where e.key in ('device', 'pixel_consent') or e.key like 'utm\_%'),
      raw = jsonb_build_object('redacted', true, 'answers',
              (select coalesce(jsonb_object_agg(a.question_key, jsonb_strip_nulls(jsonb_build_object(
                         'value_text', a.value_text, 'value_number', a.value_number,
                         'value_date', a.value_date, 'value_json', a.value_json))), '{}'::jsonb)
                 from answers a where a.response_id = r.id))
    where r.id = any (v_resp);
    update events e set response_id = null, respondent_hash = null where e.response_id = any (v_resp);
    delete from contact_notes n where n.contact_id = any (v_all);
    delete from contact_aliases a where a.contact_id = any (v_all) or a.alias_id = any (v_all);
    delete from respondent_tokens t where t.contact_id = any (v_all);
    update contacts x set
      status = 'deleted', deleted_at = now(), email = null, phone = null, first_name = null, last_name = null,
      company = null, tags = '{}', custom = '{}', lead_status = 'lost', owner_id = null,
      follow_up_at = null, follow_up_note = null
    where x.id = any (v_all);
  end if;

  update activity_log l set diff = '{"redacted": true}'::jsonb
   where l.entity = 'contact' and l.entity_id = any (v_all);

  perform set_config('survey.deletion_reason', '', true);
  perform set_config('survey.skip_log', 'off', true);
  perform set_config('survey.internal', 'off', true);

  perform write_activity(c.workspace_id, 'contact', c.id, 'erase', jsonb_build_object(
    'mode', p_mode, 'responses', cardinality(v_resp), 'files', v_files, 'answers_deleted', v_answers,
    'email_sha256', case when c.email is not null then sha256_hex(c.email) end));

  return query
    select d.id, d.bucket, d.path from storage_deletions d
     where d.workspace_id = c.workspace_id and d.reason = 'erase' and d.enqueued_at = now() and d.done_at is null;
end $$;

-- ===========================================================================
-- 2. resolve_public_survey also returns workspace_id (Phase 2C)
-- ===========================================================================
-- The return type changes, so the function is dropped and recreated. The body
-- is 0011's with w.id appended as the last column. get_public_definition is a
-- plain SQL function and resolves it by name at call time, so it needs no
-- change. Grants are restored exactly: anon stays at these two functions.
drop function resolve_public_survey(text);

-- Phase 2C. 0011's anon read path plus workspace_id (last column).
create or replace function resolve_public_survey(p_key text)
returns table (
  survey_id          uuid,
  slug               text,
  alias              text,                -- active alias, for the QR and share panel
  matched_by         text,                -- 'slug' | 'alias' | 'retired_alias'
  effective_state    text,                -- 'scheduled' | 'open' | 'closed'
  state_reason       text,                -- 'manual' | 'schedule' | 'cap' | 'admin' | 'workspace_archived' | null
  opens_at           timestamptz,
  closes_at          timestamptz,
  closed_message     text,                -- survey, else workspace default, else null (doc 02 defaults)
  version_id         uuid,                -- latest published, only when effective_state = 'open'
  version_no         int,
  title              text,                -- public title from the published definition
  og_title           text,
  og_description     text,
  og_image_path      text,
  allow_indexing     boolean,
  workspace_name     text,
  logo_path          text,
  show_powered_by    boolean,
  privacy_notice_url text,                -- workspace notice; the org notice is always /privacy
  pixel_consent_mode pixel_consent_mode,
  pixels             jsonb,               -- [{id,type,value,parsed}], enabled minus excluded; [] unless open
  workspace_id       uuid                 -- Phase 2C: spares the public routes a second lookup
)
language sql stable security definer set search_path = public, pg_temp as $$
  with k as (
    select lower(btrim(p_key)) as key
    where p_key is not null and length(p_key) between 1 and 100
  ),
  hit as (
    select h.id, h.matched_by
    from (
      select s.id, 'slug'::text as matched_by, 0 as prio from surveys s, k where s.slug = k.key
      union all
      select a.survey_id, case when a.retired_at is null then 'alias' else 'retired_alias' end, 1
      from survey_aliases a, k
      where a.alias = k.key
        and a.survey_id is not null
        and (a.retired_at is null or a.retired_at > now() - interval '30 days')
    ) h
    order by h.prio
    limit 1
  )
  select s.id, s.slug, cur.alias, h.matched_by,
         e.state, e.reason, s.opens_at, s.closes_at,
         coalesce(s.closed_message, w.default_closed_message),
         case when e.state = 'open' then v.id end,
         case when e.state = 'open' then v.version_no end,
         coalesce(v.public_definition #>> '{settings,title}', v.public_definition ->> 'title', s.title),
         s.og_title, s.og_description, s.og_image_path, s.allow_indexing,
         w.name, w.logo_path, w.show_powered_by, w.privacy_notice_url, w.pixel_consent_mode,
         case when e.state = 'open' then coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type,
                                               'value', p.value, 'parsed', p.parsed)
                            order by p.created_at)
           from workspace_pixels p
           where p.workspace_id = s.workspace_id and p.enabled
             and not (p.id = any (s.excluded_pixel_ids))
             and (p.type not in ('custom_script','gtm')
                  or coalesce((select l.raw_script_pixels_allowed from workspace_limits l
                               where l.workspace_id = s.workspace_id), true))), '[]'::jsonb)
         else '[]'::jsonb end,
         w.id
  from hit h
  join surveys s     on s.id = h.id
  join workspaces w  on w.id = s.workspace_id
  join survey_versions v on v.id = s.latest_published_version_id
  cross join lateral survey_effective_state(s, w.archived_at is not null) e
  left join survey_aliases cur on cur.survey_id = s.id and cur.retired_at is null
  where e.state <> 'draft' and w.deleted_at is null;
$$;

revoke all on function resolve_public_survey(text) from public;
grant execute on function resolve_public_survey(text) to anon, authenticated, service_role;

-- ===========================================================================
-- 3. Reserved public segments (Phase 2A)
-- ===========================================================================

-- Phase 2A. 0005's list plus 'welcome' ('join' was already reserved); kept
-- equal to DASHBOARD_SEGMENTS in src/lib/hosts.ts. The survey_aliases check
-- constraint calls this, so new aliases refuse both words.
create or replace function reserved_public_segments() returns text[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array[
    -- DASHBOARD_SEGMENTS (src/lib/hosts.ts)
    'w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev', 'welcome', 'join',
    -- docs/01 section 3
    'api', 's', 'r', 'f', 'e', 'logout', 'app', 'www', 'static', 'well-known', 'privacy',
    -- docs/02 section 2 (public host routes and files)
    'report', 'robots', 'favicon'
  ]::text[];
$$;

-- ===========================================================================
-- 4. Reports: contact custom field filters, matrix labels, share gate
-- ===========================================================================

-- Phase 2E. filtered_responses from 0013 plus contact custom field filters
-- (docs/04 section 4.3) and {ids, other} aware answer filters. New filter key:
--   contact.custom: [{key, op: 'eq' (default) | 'contains', value}]
--     eq        contacts.custom -> key equals value as jsonb
--     contains  array field: contains value (or every element of an array
--               value); scalar field: case-insensitive substring of the text
-- Every entry must match. Like the other contact filters it excludes
-- anonymous responses.
create or replace function filtered_responses(p_survey_id uuid, p_filters jsonb default '{}')
returns setof responses language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_latest uuid;
begin
  if f #> '{contact,custom}' is not null and (
       jsonb_typeof(f #> '{contact,custom}') <> 'array'
       or exists (select 1 from jsonb_array_elements(f #> '{contact,custom}') cf
                  where jsonb_typeof(cf) <> 'object' or coalesce(cf ->> 'key', '') = '' or not (cf ? 'value')
                     or coalesce(cf ->> 'op', 'eq') not in ('eq', 'contains'))) then
    raise exception 'Custom field filters must be [{key, op, value}] with op eq or contains' using errcode = '22023';
  end if;
  select latest_published_version_id into v_latest from surveys where id = p_survey_id;
  return query
  select r.*
  from responses r
  left join contacts c on c.id = r.contact_id
  where r.survey_id = p_survey_id
    and (coalesce(f ->> 'status', 'complete') = 'all' or r.status = 'complete')
    and case coalesce(f ->> 'version', 'latest')
          when 'all'    then true
          when 'latest' then r.survey_version_id = v_latest
          else r.survey_version_id::text = f ->> 'version' end
    and (f ->> 'from' is null or coalesce(r.submitted_at, r.started_at) >= (f ->> 'from')::timestamptz)
    and (f ->> 'to'   is null or coalesce(r.submitted_at, r.started_at) <  (f ->> 'to')::timestamptz)
    and case coalesce(f ->> 'identity', 'all')
          when 'token'      then r.identity_source = 'token'
          when 'identified' then r.contact_id is not null
          when 'anonymous'  then r.contact_id is null
          else true end
    and (f -> 'contact' is null or (
          c.id is not null
          and (f #> '{contact,lead_status}' is null
               or c.lead_status::text in (select jsonb_array_elements_text(f #> '{contact,lead_status}')))
          and (f #> '{contact,tags}' is null
               or c.tags && array(select jsonb_array_elements_text(f #> '{contact,tags}')))
          and (f #> '{contact,owner_ids}' is null
               or c.owner_id::text in (select jsonb_array_elements_text(f #> '{contact,owner_ids}')))
          and (f #> '{contact,custom}' is null or not exists (
                select 1 from jsonb_array_elements(f #> '{contact,custom}') cf
                where not coalesce(
                  case coalesce(cf ->> 'op', 'eq')
                    when 'eq' then c.custom -> (cf ->> 'key') = cf -> 'value'
                    else case jsonb_typeof(c.custom -> (cf ->> 'key'))
                           when 'array' then c.custom -> (cf ->> 'key') @>
                                  case when jsonb_typeof(cf -> 'value') = 'array' then cf -> 'value'
                                       else jsonb_build_array(cf -> 'value') end
                           else position(lower(cf ->> 'value') in lower(c.custom ->> (cf ->> 'key'))) > 0 end
                  end, false)))))
    and (f -> 'answers' is null or not exists (
          select 1 from jsonb_array_elements(f -> 'answers') af
          where not exists (
            select 1 from answers a
            where a.response_id = r.id and a.question_key = af ->> 'question_key'
              and (af -> 'any_of' is null
                   or a.value_text in (select jsonb_array_elements_text(af -> 'any_of'))
                   or multi_choice_ids(a.value_json) ?| array(select jsonb_array_elements_text(af -> 'any_of')))
              and (af ->> 'min' is null or a.value_number >= (af ->> 'min')::numeric)
              and (af ->> 'max' is null or a.value_number <= (af ->> 'max')::numeric))));
end $$;

-- Phase 2E. {id, label} pairs from a questions snapshot array (options, matrix
-- rows or columns). Drops every other key, so a server-only score can never
-- reach a shared report.
create or replace function snapshot_labels(p_items jsonb) returns jsonb
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_items) = 'array' then (
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'label', coalesce(x ->> 'label', x ->> 'id')) order by n), '[]'::jsonb)
    from jsonb_array_elements(p_items) with ordinality t(x, n)
    where jsonb_typeof(x) = 'object' and x ? 'id') end;
$$;
revoke all on function snapshot_labels(jsonb) from public;

-- Phase 2E. shared_report_payload from 0013 with two changes: each widget
-- carries matrix `rows` and `columns` ({id, label} only) so the shared page
-- can label heat tables, and options are reduced to {id, label}. Views are no
-- longer counted here; report_share_gate counts one view per page load.
create or replace function shared_report_payload(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sh  report_shares;
  rep reports;
  s   surveys;
  w   workspaces;
  v_widgets jsonb;
begin
  if p_token is null or length(p_token) not between 8 and 100 then
    return null;
  end if;
  select * into sh from report_shares where token = p_token;
  if sh.id is null or sh.revoked_at is not null or (sh.expires_at is not null and sh.expires_at <= now()) then
    return null;
  end if;
  if sh.password_hash is not null
     and (p_password is null or extensions.crypt(p_password, sh.password_hash) <> sh.password_hash) then
    return null;
  end if;
  select * into rep from reports where id = sh.report_id;
  select * into s from surveys where id = rep.survey_id;
  select * into w from workspaces where id = s.workspace_id;
  if w.deleted_at is not null or s.workspace_id <> sh.workspace_id then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rw.id, 'position', rw.position, 'chart_type', rw.chart_type,
           'question_key', rw.question_key, 'metric', rw.metric,
           'label', q.label,
           'options', snapshot_labels(q.options),
           'rows', case when q.type = 'matrix' then snapshot_labels(q.config #> '{settings,rows}') end,
           'columns', case when q.type = 'matrix' then snapshot_labels(q.config #> '{settings,columns}') end,
           'result', report_widget_data(s.id, rep.filters, rw.question_key, rw.metric))
         order by rw.position), '[]')
    into v_widgets
    from report_widgets rw
    left join questions q on q.survey_version_id = s.latest_published_version_id and q.question_key = rw.question_key
   where rw.report_id = rep.id;

  return jsonb_build_object(
    'report', jsonb_build_object('name', rep.name),
    'survey', jsonb_build_object('title', s.title),
    'workspace', jsonb_build_object('name', w.name, 'logo_path', w.logo_path),
    'widgets', v_widgets);
end $$;

-- Phase 2E. bcrypt hash for report_shares.password_hash, so the app never
-- hashes share passwords itself. Pure: reads no table.
create or replace function hash_share_password(p_password text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_password is null or length(p_password) not between 6 and 200 then
    raise exception 'Share passwords are 6 to 200 characters' using errcode = '22023';
  end if;
  return extensions.crypt(p_password, extensions.gen_salt('bf'));
end $$;
revoke all on function hash_share_password(text) from public;
grant execute on function hash_share_password(text) to authenticated, service_role;

-- Phase 2E. Gate for the public /r/{token} page. Service role only.
-- status 'not_found'      unknown, revoked or expired token, or deleted workspace
--        'needs_password' the share has a password and none or a wrong one was given
--        'open'           valid; report_id is set and one view is counted
create or replace function report_share_gate(p_token text, p_password text default null)
returns table (status text, report_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  sh report_shares;
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  if p_token is null or length(p_token) not between 8 and 100 then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  select x.* into sh from report_shares x where x.token = p_token for update;
  if sh.id is null or sh.revoked_at is not null or (sh.expires_at is not null and sh.expires_at <= now())
     or not exists (select 1 from reports rp join surveys s on s.id = rp.survey_id join workspaces w on w.id = s.workspace_id
                    where rp.id = sh.report_id and w.deleted_at is null and w.id = sh.workspace_id) then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if sh.password_hash is not null
     and (p_password is null or extensions.crypt(p_password, sh.password_hash) <> sh.password_hash) then
    return query select 'needs_password'::text, null::uuid;
    return;
  end if;
  perform set_config('survey.internal', 'on', true);
  update report_shares x set view_count = x.view_count + 1, last_viewed_at = now() where x.id = sh.id;
  perform set_config('survey.internal', 'off', true);
  return query select 'open'::text, sh.report_id;
end $$;
revoke all on function report_share_gate(text, text) from public;
grant execute on function report_share_gate(text, text) to service_role;

-- ===========================================================================
-- 5. Exports and imports (Phase 2D, 2E)
-- ===========================================================================

-- Phase 2D. activity_log row for an export (docs/04 section 6). Row level
-- kinds ('responses', 'contacts') need editor; aggregate kinds ('summary',
-- 'report') are open to viewers, matching doc 05's export rule. p_scope is
-- stored as the diff with row_count added; survey_id and job_id in it, when
-- present, must belong to the workspace.
create or replace function log_export(p_workspace_id uuid, p_kind text, p_scope jsonb, p_row_count int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_scope  jsonb := coalesce(p_scope, '{}'::jsonb);
  v_survey uuid;
  v_job    uuid;
begin
  if p_kind is null or p_kind not in ('responses', 'contacts', 'summary', 'report') then
    raise exception 'Export kind must be responses, contacts, summary or report' using errcode = '22023';
  end if;
  if not is_member(p_workspace_id, case when p_kind in ('summary', 'report') then 'viewer' else 'editor' end::workspace_role) then
    raise exception 'not_authorized';
  end if;
  if jsonb_typeof(v_scope) <> 'object' or octet_length(v_scope::text) > 16384 then
    raise exception 'Export scope must be an object under 16 KB' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'Export row count must be zero or more' using errcode = '22023';
  end if;
  v_survey := (v_scope ->> 'survey_id')::uuid;   -- a malformed id raises 22P02 (invalid_value)
  v_job := (v_scope ->> 'job_id')::uuid;
  if v_survey is not null and not exists (select 1 from surveys where id = v_survey and workspace_id = p_workspace_id) then
    raise exception 'not_found';
  end if;
  if v_job is not null and not exists (select 1 from export_jobs where id = v_job and workspace_id = p_workspace_id) then
    raise exception 'not_found';
  end if;
  perform write_activity(p_workspace_id, 'export', coalesce(v_job, v_survey), 'export_' || p_kind,
                         v_scope || jsonb_build_object('row_count', p_row_count));
end $$;
revoke all on function log_export(uuid, text, jsonb, int) from public;
grant execute on function log_export(uuid, text, jsonb, int) to authenticated;

-- Phase 2D. Closes a contact import. p_summary: {status: 'done' (default) |
-- 'failed', created?, updated?, skipped?, invalid?, error?}. Counts given here
-- replace the totals import_contacts_chunk accumulated; absent ones are kept.
create or replace function finish_import(p_import_id uuid, p_summary jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  imp      contact_imports;
  v_sum    jsonb := coalesce(p_summary, '{}'::jsonb);
  v_status text;
  v_key    text;
begin
  select * into imp from contact_imports where id = p_import_id for update;
  if imp.id is null or not is_member(imp.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if imp.status in ('done', 'failed') then
    raise exception 'import_finished';
  end if;
  if jsonb_typeof(v_sum) <> 'object' then
    raise exception 'Import summary must be an object' using errcode = '22023';
  end if;
  v_status := coalesce(v_sum ->> 'status', 'done');
  if v_status not in ('done', 'failed') then
    raise exception 'Import status must be done or failed' using errcode = '22023';
  end if;
  foreach v_key in array array['created', 'updated', 'skipped', 'invalid'] loop
    if v_sum ? v_key and (jsonb_typeof(v_sum -> v_key) <> 'number' or (v_sum ->> v_key)::numeric < 0
                          or (v_sum ->> v_key)::numeric <> trunc((v_sum ->> v_key)::numeric)) then
      raise exception 'Import counts must be whole numbers, zero or more' using errcode = '22023';
    end if;
  end loop;
  update contact_imports set
    status      = v_status,
    finished_at = now(),
    created     = coalesce((v_sum ->> 'created')::int, created),
    updated     = coalesce((v_sum ->> 'updated')::int, updated),
    skipped     = coalesce((v_sum ->> 'skipped')::int, skipped),
    invalid     = coalesce((v_sum ->> 'invalid')::int, invalid)
  where id = imp.id
  returning * into imp;
  perform write_activity(imp.workspace_id, 'import', imp.id, case when v_status = 'done' then 'finish' else 'fail' end,
    jsonb_strip_nulls(jsonb_build_object('created', imp.created, 'updated', imp.updated, 'skipped', imp.skipped,
                                         'invalid', imp.invalid, 'error', left(v_sum ->> 'error', 500))));
end $$;
revoke all on function finish_import(uuid, jsonb) from public;
grant execute on function finish_import(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 6. Workspaces, members, invites, purge queue (Phase 2A)
-- ===========================================================================

-- Phase 2A. One row per workspace (deleted ones included) for /admin.
-- Numbers and the owner id only, never workspace rows.
create or replace function admin_workspace_stats()
returns table (workspace_id uuid, owner_id uuid, member_count bigint, survey_count bigint,
               response_count bigint, storage_bytes_used bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  return query
    select w.id,
           (select m.user_id from workspace_members m where m.workspace_id = w.id and m.role = 'owner'),
           (select count(*) from workspace_members m where m.workspace_id = w.id),
           (select count(*) from surveys s where s.workspace_id = w.id),
           (select count(*) from responses r where r.workspace_id = w.id),
           w.storage_bytes_used
      from workspaces w
     order by w.name;
end $$;
revoke all on function admin_workspace_stats() from public;
grant execute on function admin_workspace_stats() to authenticated;

-- Phase 2A. What /invite/{token} may show a signed-in visitor before they
-- accept: workspace name, logo path and role, for an open workspace invite
-- only (not revoked, not expired, uses left, workspace live). Zero rows for
-- anything else, identical for every failure.
create or replace function invite_preview(p_token text)
returns table (workspace_name text, logo_path text, role workspace_role)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.name, w.logo_path, i.role
    from workspace_invites i
    join workspaces w on w.id = i.workspace_id
   where auth.uid() is not null
     and p_token is not null and length(btrim(p_token)) between 8 and 200
     and i.token = btrim(p_token)
     and i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses
     and w.deleted_at is null and w.archived_at is null;
$$;
revoke all on function invite_preview(text) from public;
grant execute on function invite_preview(text) to authenticated;

-- Phase 2A. Members with their sign-in email for the members settings page.
-- Admin or owner of the workspace only.
create or replace function workspace_members_with_email(p_workspace_id uuid)
returns table (user_id uuid, role workspace_role, display_name text, avatar_url text,
               status profile_status, email text, invite_id uuid, joined_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not is_member(p_workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  return query
    select m.user_id, m.role, p.display_name, p.avatar_url, p.status, u.email::text, m.invite_id, m.created_at
      from workspace_members m
      join profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.workspace_id = p_workspace_id
     order by m.role desc, p.display_name;
end $$;
revoke all on function workspace_members_with_email(uuid) from public;
grant execute on function workspace_members_with_email(uuid) to authenticated;

-- Phase 2A. Undone storage_deletions for one workspace, including after
-- purge_workspace removed the row (workspace_id has no foreign key). Service
-- role only, for /api/cron/workspace-purge.
create or replace function pending_storage_deletions(p_workspace_id uuid)
returns table (deletion_id bigint, bucket text, path text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  return query
    select d.id, d.bucket, d.path from storage_deletions d
     where d.workspace_id = p_workspace_id and d.done_at is null and d.attempts < 10
     order by d.id limit 1000;
end $$;
revoke all on function pending_storage_deletions(uuid) from public;
grant execute on function pending_storage_deletions(uuid) to service_role;

-- ===========================================================================
-- 7. Platform admin writes that audit themselves (Phase 2A)
-- ===========================================================================
-- Workspace create (admin_create_workspace), limits (admin_set_workspace_limits),
-- owner assignment (transfer_workspace_ownership, forced) and access request
-- approval (admin_approve_access_request) already audit in 0003. These cover
-- the remaining plain table writes, so /admin never needs the service role to
-- insert platform_audit_log rows. Action names match what 2A wrote.

-- Phase 2A. Issue a platform invite (optional email, note, 1 to 90 days).
-- Returns the row, token included, so the admin can copy the link. A second
-- open invite for the same email fails with unique_violation.
create or replace function admin_issue_platform_invite(p_email text default null, p_note text default null,
                                                       p_expires_in_days int default 30)
returns platform_invites language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
  v_note  text := nullif(btrim(p_note), '');
  v_inv   platform_invites;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if v_email is not null and (length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if length(v_note) > 200 then
    raise exception 'Use 200 characters or fewer for the note' using errcode = '22023';
  end if;
  if p_expires_in_days is null or p_expires_in_days not between 1 and 90 then
    raise exception 'Invites expire in 1 to 90 days' using errcode = '22023';
  end if;
  insert into platform_invites (email, note, invited_by, expires_at)
  values (v_email, v_note, auth.uid(), now() + make_interval(days => p_expires_in_days))
  returning * into v_inv;
  perform write_platform_audit('invite.create', 'invite', v_inv.id,
    jsonb_build_object('email', v_email, 'expires_at', v_inv.expires_at));
  return v_inv;
end $$;

-- Phase 2A. Revoke an open (unused, unrevoked) platform invite.
create or replace function admin_revoke_platform_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  update platform_invites set revoked_at = now()
   where id = p_invite_id and revoked_at is null and used_at is null;
  if not found then
    raise exception 'invalid_state';
  end if;
  perform write_platform_audit('invite.revoke', 'invite', p_invite_id);
end $$;

-- Phase 2A. Replace the organization privacy notice (Markdown, up to 50,000 characters).
create or replace function admin_update_privacy_notice(p_markdown text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_markdown is null or length(p_markdown) > 50000 then
    raise exception 'The notice is longer than 50,000 characters' using errcode = '22023';
  end if;
  insert into platform_settings (id, privacy_notice_md, updated_by) values (true, p_markdown, auth.uid())
  on conflict (id) do update set privacy_notice_md = excluded.privacy_notice_md, updated_by = excluded.updated_by;
  perform write_platform_audit('settings.privacy_notice', 'settings', null,
    jsonb_build_object('length', length(p_markdown)));
end $$;

-- Phase 2A. Move an abuse report to open, dismissed or actioned.
create or replace function admin_set_abuse_report_status(p_report_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_status is null or p_status not in ('open', 'dismissed', 'actioned') then
    raise exception 'Status must be open, dismissed or actioned' using errcode = '22023';
  end if;
  update abuse_reports set
    status      = p_status,
    reviewed_by = case when p_status = 'open' then null else auth.uid() end,
    reviewed_at = case when p_status = 'open' then null else now() end
  where id = p_report_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform write_platform_audit('abuse_report.' || p_status, 'abuse_report', p_report_id);
end $$;

-- Phase 2A. Dismiss an open access request (approval is admin_approve_access_request).
create or replace function admin_dismiss_access_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  update access_requests set status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request_id and status = 'open'
  returning user_id into v_user;
  if v_user is null then
    raise exception 'invalid_state';
  end if;
  perform write_platform_audit('access_request.dismiss', 'user', v_user, jsonb_build_object('request_id', p_request_id));
end $$;

-- Phase 2A. Dismiss an open workspace request (approval is admin_create_workspace(p_request_id)).
create or replace function admin_dismiss_workspace_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  update workspace_requests set status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request_id and status = 'open'
  returning requested_by into v_user;
  if v_user is null then
    raise exception 'invalid_state';
  end if;
  perform write_platform_audit('workspace_request.dismiss', 'user', v_user, jsonb_build_object('request_id', p_request_id));
end $$;

revoke all on function admin_issue_platform_invite(text, text, int), admin_revoke_platform_invite(uuid),
  admin_update_privacy_notice(text), admin_set_abuse_report_status(uuid, text),
  admin_dismiss_access_request(uuid), admin_dismiss_workspace_request(uuid) from public;
grant execute on function admin_issue_platform_invite(text, text, int), admin_revoke_platform_invite(uuid),
  admin_update_privacy_notice(text), admin_set_abuse_report_status(uuid, text),
  admin_dismiss_access_request(uuid), admin_dismiss_workspace_request(uuid) to authenticated;
