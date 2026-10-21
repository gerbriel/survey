-- 0006: publish_survey_version, delete_survey, alias retire-on-delete trigger,
-- admin_close_survey, plus the definition validation helpers publish uses.
-- Spec: docs/01-data-model.md sections 4 and 12; docs/03 sections 1, 2, 2.1, 7.

-- Server-only keys (docs/03 section 2.1) that must never appear anywhere in a
-- public_definition. MUST match SERVER_ONLY_KEYS in src/lib/survey/split.ts.
-- Scored calcs and scored set_ending rules are removed whole by
-- splitDefinition; they carry no distinctive key, so SQL cannot detect them.
create or replace function server_only_keys() returns text[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array['score', 'correct_option_id', 'correct_option_ids', 'yes_score', 'no_score']::text[];
$$;
grant execute on function server_only_keys() to authenticated, service_role;

-- Answers column a question type writes (docs/03 section 1). 'none' for
-- display-only blocks, null for an unknown type.
create or replace function question_storage_column(p_type text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when p_type in ('short_text','long_text','email','phone','single_choice','dropdown','time','hidden') then 'value_text'
    when p_type in ('number','yes_no','rating','nps','consent','calculated')                         then 'value_number'
    when p_type = 'date'                                                                             then 'value_date'
    when p_type in ('multiple_choice','matrix','ranking','file_upload','signature','address')        then 'value_json'
    when p_type in ('statement','image','page_break')                                                then 'none'
  end;
$$;
grant execute on function question_storage_column(text) to authenticated, service_role;

-- First key from p_keys found at any depth of p_doc, or null.
create or replace function jsonb_find_key(p_doc jsonb, p_keys text[]) returns text
language sql immutable set search_path = public, pg_temp as $$
  with recursive walk(v) as (
    select p_doc
    union all
    select c.v
    from walk w
    cross join lateral (
      select e.value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v end) e
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v end) a
    ) c
  )
  select k
  from walk, jsonb_object_keys(case when jsonb_typeof(walk.v) = 'object' then walk.v end) k
  where k = any (p_keys)
  limit 1;
$$;

-- Raises on the first problem. Shape per docs/03 section 2: `pages` array of
-- {id, question_ids[]}, `questions` map keyed by question id.
create or replace function validate_survey_definition(p_definition jsonb, p_workspace_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  l       record;
  v_qs    jsonb;
  v_page  jsonb;
  v_qid   text;
  v_q     jsonb;
  v_seen  text[] := '{}';
  v_keys  text[] := '{}';
  v_ids   text[];
  v_key   text;
  v_type  text;
  v_ref   text;
begin
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception 'invalid_definition: not an object';
  end if;
  if jsonb_typeof(p_definition -> 'pages') is distinct from 'array' then
    raise exception 'invalid_definition: pages must be an array';
  end if;
  v_qs := coalesce(p_definition -> 'questions', '{}'::jsonb);
  if jsonb_typeof(v_qs) <> 'object' then
    raise exception 'invalid_definition: questions must be an object keyed by question id';
  end if;
  select * into l from effective_limits(p_workspace_id);
  if octet_length(p_definition::text) > l.max_definition_bytes then
    raise exception 'definition_too_large';
  end if;
  if definition_question_count(p_definition) > l.max_questions then
    raise exception 'too_many_questions';
  end if;

  for v_page in select value from jsonb_array_elements(p_definition -> 'pages') loop
    if jsonb_typeof(v_page) <> 'object' then
      raise exception 'invalid_definition: page must be an object';
    end if;
    if v_page ? 'question_ids' and jsonb_typeof(v_page -> 'question_ids') <> 'array' then
      raise exception 'invalid_definition: page question_ids must be an array';
    end if;
    for v_qid in select value #>> '{}' from jsonb_array_elements(coalesce(v_page -> 'question_ids', '[]'::jsonb)) loop
      if v_qid is null or not (v_qs ? v_qid) then
        raise exception 'invalid_definition: page references unknown question %', v_qid;
      end if;
      if v_qid = any (v_seen) then
        raise exception 'invalid_definition: question % appears on more than one page', v_qid;
      end if;
      v_seen := v_seen || v_qid;
    end loop;
  end loop;

  for v_qid, v_q in select key, value from jsonb_each(v_qs) loop
    if jsonb_typeof(v_q) <> 'object' then
      raise exception 'invalid_definition: question % must be an object', v_qid;
    end if;
    v_key := v_q ->> 'question_key';
    if v_key is null or v_key !~ '^q_[a-z0-9]{8}$' then
      raise exception 'invalid_question_key: %', coalesce(v_key, '(missing)');
    end if;
    if v_key = any (v_keys) then
      raise exception 'duplicate_question_key: %', v_key;
    end if;
    v_keys := v_keys || v_key;
    v_type := v_q ->> 'type';
    if question_storage_column(v_type) is null then
      raise exception 'unknown_question_type: % (%)', coalesce(v_type, '(missing)'), v_key;
    end if;
    -- option ids, matrix row ids and column ids: present, strings, unique per question
    foreach v_ref in array array['options', 'rows', 'columns'] loop
      if jsonb_typeof(v_q -> 'settings' -> v_ref) = 'array' then
        select array_agg(e ->> 'id') into v_ids from jsonb_array_elements(v_q -> 'settings' -> v_ref) e;
        if exists (select 1 from unnest(v_ids) i where i is null or i = '') then
          raise exception 'invalid_option_id: % % has an option without an id', v_key, v_ref;
        end if;
        if (select count(distinct i) from unnest(v_ids) i) <> coalesce(array_length(v_ids, 1), 0) then
          raise exception 'duplicate_option_id: % %', v_key, v_ref;
        end if;
      end if;
    end loop;
  end loop;

  v_ref := p_definition #>> '{identity,email_question_id}';
  if v_ref is not null and (v_qs -> v_ref ->> 'type') is distinct from 'email' then
    raise exception 'invalid_identity: email_question_id must point at an email question';
  end if;
  v_ref := p_definition #>> '{identity,phone_question_id}';
  if v_ref is not null and (v_qs -> v_ref ->> 'type') is distinct from 'phone' then
    raise exception 'invalid_identity: phone_question_id must point at a phone question';
  end if;
end $$;

-- Ordered question rows of a definition, as the snapshot stores them.
create or replace function definition_questions(p_definition jsonb)
returns table (question_id text, question_key text, page_index int, page_id text, "position" int, q jsonb)
language sql immutable set search_path = public, pg_temp as $$
  with pages as (
    select p.value as page, (p.ordinality - 1)::int as page_index
    from jsonb_array_elements(coalesce(p_definition -> 'pages', '[]'::jsonb)) with ordinality p
  ), ids as (
    select pg.page_index, pg.page ->> 'id' as page_id, x.value #>> '{}' as qid, x.ordinality as ord
    from pages pg, jsonb_array_elements(coalesce(pg.page -> 'question_ids', '[]'::jsonb)) with ordinality x
  )
  select i.qid, p_definition -> 'questions' -> i.qid ->> 'question_key', i.page_index, i.page_id,
         (row_number() over (order by i.page_index, i.ord))::int,
         p_definition -> 'questions' -> i.qid
  from ids i
  where p_definition -> 'questions' ? i.qid;
$$;

create or replace function richtext_plain(p jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p) when 'object' then coalesce(p ->> 'text', '')
                              when 'string' then p #>> '{}'
                              else '' end;
$$;

create or replace function publish_survey_version(p_version_id uuid, p_expected_revision int, p_public_definition jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v        survey_versions;
  s        surveys;
  l        record;
  v_bad    text;
  v_new    uuid;
  v_email  text;
  v_phone  text;
begin
  select * into v from survey_versions where id = p_version_id;
  if v.id is null or not is_member(v.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  select * into s from surveys where id = v.survey_id for update;
  select * into v from survey_versions where id = p_version_id for update;
  if v.status <> 'draft' then
    raise exception 'not_draft';
  end if;
  if v.locked_by is not null and v.locked_by <> v_uid and v.locked_at >= now() - interval '15 minutes' then
    raise exception 'lock_held';
  end if;
  if p_expected_revision is null or v.revision <> p_expected_revision then
    raise exception 'revision_conflict';
  end if;

  perform validate_survey_definition(v.definition, v.workspace_id);

  -- A key may never come back with a different storage column.
  select d.question_key into v_bad
    from definition_questions(v.definition) d
    join questions old on old.survey_id = s.id and old.question_key = d.question_key
   where question_storage_column(old.type) <> question_storage_column(d.q ->> 'type')
   limit 1;
  if v_bad is not null then
    raise exception 'key_type_conflict: %', v_bad;
  end if;

  if p_public_definition is null or jsonb_typeof(p_public_definition) <> 'object'
     or jsonb_typeof(p_public_definition -> 'pages') is distinct from 'array' then
    raise exception 'invalid_public_definition';
  end if;
  v_bad := jsonb_find_key(p_public_definition, server_only_keys());
  if v_bad is not null then
    raise exception 'server_only_key_in_public_definition: %', v_bad;
  end if;
  select * into l from effective_limits(v.workspace_id);
  if octet_length(p_public_definition::text) > l.max_definition_bytes then
    raise exception 'definition_too_large';
  end if;

  perform set_config('survey.publishing', 'on', true);
  update survey_versions
     set status = 'published', public_definition = p_public_definition, published_at = now(),
         published_by = v_uid, definition_hash = sha256_hex(definition::text),
         locked_by = null, locked_at = null
   where id = p_version_id;

  insert into questions (survey_version_id, survey_id, workspace_id, question_key, page_index, position,
                         type, label, label_hash, required, is_pii, options, config)
  select v.id, s.id, s.workspace_id, d.question_key, d.page_index, d.position,
         d.q ->> 'type',
         richtext_plain(d.q -> 'label'),
         sha256_hex(richtext_plain(d.q -> 'label')),
         coalesce((d.q ->> 'required')::boolean, false),
         coalesce((d.q ->> 'pii')::boolean, (d.q ->> 'type') in ('address', 'signature')),
         case when jsonb_typeof(d.q -> 'settings' -> 'options') = 'array' then
           (select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'label', o ->> 'label') order by n)
              from jsonb_array_elements(d.q -> 'settings' -> 'options') with ordinality x(o, n)) end,
         jsonb_strip_nulls(jsonb_build_object(
           'question_id', d.question_id, 'page_id', d.page_id, 'settings', d.q -> 'settings',
           'validation', d.q -> 'validation', 'contact_field', d.q -> 'contact_field', 'help', d.q -> 'help'))
  from definition_questions(v.definition) d;

  insert into survey_versions (survey_id, workspace_id, version_no, status, revision, definition,
                               created_from_version_id, locked_by, locked_at)
  values (s.id, s.workspace_id, v.version_no + 1, 'draft', 0, v.definition, v.id, v_uid, now())
  returning id into v_new;

  v_email := v.definition -> 'questions' -> (v.definition #>> '{identity,email_question_id}') ->> 'question_key';
  v_phone := v.definition -> 'questions' -> (v.definition #>> '{identity,phone_question_id}') ->> 'question_key';
  update surveys
     set latest_published_version_id = v.id,
         current_draft_version_id = v_new,
         identity_question_key = v_email,
         identity_phone_key = v_phone,
         trust_hidden_identity = coalesce((v.definition #>> '{settings,trust_hidden_identity}')::boolean,
                                          trust_hidden_identity)
   where id = s.id;
  perform set_config('survey.publishing', 'off', true);

  perform write_activity(s.workspace_id, 'survey', s.id, 'publish',
    jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'new_draft_id', v_new));
  return v_new;
end $$;

-- Retire the active alias before a survey row goes, so the alias is held for
-- 30 days (resolving to nothing once survey_id is nulled) instead of freed.
create or replace function retire_alias_on_survey_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update survey_aliases set retired_at = now() where survey_id = old.id and retired_at is null;
  return old;
end $$;
create trigger surveys_retire_alias before delete on surveys
  for each row execute function retire_alias_on_survey_delete();

create or replace function delete_survey(p_survey_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s surveys;
begin
  select * into s from surveys where id = p_survey_id for update;
  if s.id is null or not is_member(s.workspace_id, 'admin') then
    raise exception 'not_authorized';
  end if;
  perform write_activity(s.workspace_id, 'survey', s.id, 'delete',
    jsonb_build_object('title', s.title, 'slug', s.slug, 'complete_count', s.complete_count));
  perform set_config('survey.deletion_reason', 'survey_delete', true);
  perform set_config('survey.purge', 'on', true);
  delete from surveys where id = p_survey_id;
  perform set_config('survey.purge', 'off', true);
  perform set_config('survey.deletion_reason', '', true);
end $$;

create or replace function admin_close_survey(p_survey_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ws uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'reason_required';
  end if;
  perform set_config('survey.internal', 'on', true);
  update surveys set admin_closed_at = now(), admin_closed_reason = btrim(p_reason)
   where id = p_survey_id returning workspace_id into v_ws;
  perform set_config('survey.internal', 'off', true);
  if v_ws is null then
    raise exception 'not_found';
  end if;
  perform write_platform_audit('survey.admin_close', 'survey', p_survey_id,
    jsonb_build_object('reason', btrim(p_reason), 'workspace_id', v_ws));
end $$;

grant execute on function publish_survey_version(uuid, int, jsonb), delete_survey(uuid), admin_close_survey(uuid, text)
  to authenticated;
