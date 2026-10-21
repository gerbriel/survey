-- 0014: merge_contacts, erase_respondent, export_respondent_data.
-- Spec: docs/01-data-model.md section 12; docs/04 sections 2.5, 7.2 to 7.4.
-- Erasure follows the Fresno Skillshare 00004 tombstone pattern.

-- p_field_choices: {"<field>": "<contact id to take the value from>"} for core
-- fields (email, phone, first_name, last_name, company, owner_id,
-- follow_up_at, follow_up_note, source) and "custom.<key>" for custom fields.
-- Without a choice the survivor keeps its value and blanks are filled from
-- the losers in the order given.
create or replace function merge_contacts(p_survivor uuid, p_merged uuid[], p_field_choices jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sv       contacts;
  v_ws     uuid;
  v_losers uuid[];
  v_all    uuid[];
  v_choice jsonb := coalesce(p_field_choices, '{}'::jsonb);
  v_field  text;
  v_from   uuid;
  v_vals   jsonb;
  v_custom jsonb;
  v_status lead_status;
  v_snap   jsonb;
begin
  v_losers := array(select distinct x from unnest(p_merged) x where x is not null and x <> p_survivor);
  if cardinality(v_losers) not between 1 and 4 then
    raise exception 'merge_size: merge 2 to 5 contacts';
  end if;
  v_all := p_survivor || v_losers;
  select * into sv from contacts where id = p_survivor for update;
  v_ws := sv.workspace_id;
  if sv.id is null or not is_member(v_ws, 'editor') then
    raise exception 'not_authorized';
  end if;
  perform 1 from contacts where id = any (v_losers) for update;
  if (select count(*) from contacts
      where id = any (v_all) and workspace_id = v_ws and status = 'active' and merged_into is null) <> cardinality(v_all) then
    raise exception 'invalid_contacts: all contacts must be live and in one workspace';
  end if;

  -- Snapshot every contact as JSON (survivor first) before anything moves.
  select jsonb_object_agg(c.id::text, to_jsonb(c)) into v_snap from contacts c where c.id = any (v_all);

  -- Resolve field values.
  v_vals := '{}'::jsonb;
  foreach v_field in array array['email','phone','first_name','last_name','company','owner_id',
                                 'follow_up_at','follow_up_note','source'] loop
    v_from := nullif(v_choice ->> v_field, '')::uuid;
    if v_from is not null and v_from = any (v_all) then
      v_vals := v_vals || jsonb_build_object(v_field, v_snap -> v_from::text -> v_field);
    else
      v_vals := v_vals || jsonb_build_object(v_field, coalesce(
        (select v_snap -> x::text -> v_field from unnest(v_all) with ordinality u(x, o)
          where v_snap -> x::text -> v_field <> 'null'::jsonb order by o limit 1), 'null'::jsonb));
    end if;
  end loop;
  v_custom := '{}'::jsonb;
  for i in reverse cardinality(v_all)..1 loop
    v_custom := v_custom || coalesce(v_snap -> v_all[i]::text -> 'custom', '{}'::jsonb);   -- survivor applied last, wins
  end loop;
  for v_field, v_from in select substr(key, 8), nullif(value #>> '{}', '')::uuid from jsonb_each(v_choice) where key like 'custom.%' loop
    if v_from = any (v_all) then
      v_custom := v_custom || jsonb_build_object(v_field, v_snap -> v_from::text -> 'custom' -> v_field);
    end if;
  end loop;
  select case when bool_and(lead_status = 'lost') then 'lost'::lead_status
              else max(lead_status) filter (where lead_status <> 'lost') end
    into v_status from contacts where id = any (v_all);

  perform set_config('survey.internal', 'on', true);
  perform set_config('survey.skip_log', 'on', true);

  update responses set contact_id = p_survivor where contact_id = any (v_losers);
  delete from respondent_tokens t
   where t.contact_id = any (v_losers)
     and (exists (select 1 from respondent_tokens s where s.contact_id = p_survivor and s.survey_id = t.survey_id)
          or exists (select 1 from respondent_tokens t2 where t2.contact_id = any (v_losers)
                     and t2.survey_id = t.survey_id and t2.id < t.id));
  update respondent_tokens set contact_id = p_survivor where contact_id = any (v_losers);
  update contact_notes set contact_id = p_survivor where contact_id = any (v_losers);
  delete from contact_duplicate_dismissals where contact_a = any (v_losers) or contact_b = any (v_losers);

  insert into contact_aliases (alias_id, contact_id, workspace_id, email, phone, merged_by)
  select c.id, p_survivor, v_ws, c.email, c.phone, auth.uid() from contacts c where c.id = any (v_losers);
  update contact_aliases set contact_id = p_survivor where contact_id = any (v_losers);

  update contacts set merged_into = p_survivor, merged_at = now(), email = null, phone = null
   where id = any (v_losers);
  update contacts set
    email          = v_vals ->> 'email',
    phone          = v_vals ->> 'phone',
    first_name     = v_vals ->> 'first_name',
    last_name      = v_vals ->> 'last_name',
    company        = v_vals ->> 'company',
    owner_id       = (v_vals ->> 'owner_id')::uuid,
    follow_up_at   = (v_vals ->> 'follow_up_at')::date,
    follow_up_note = v_vals ->> 'follow_up_note',
    source         = v_vals ->> 'source',
    tags           = (select coalesce(array_agg(distinct t), '{}') from contacts c, unnest(c.tags) t where c.id = any (v_all)),
    custom         = jsonb_strip_nulls(v_custom),
    lead_status    = v_status,
    response_count = (select count(*) from responses where contact_id = p_survivor and status = 'complete'),
    last_response_at = (select max(submitted_at) from responses where contact_id = p_survivor)
  where id = p_survivor;

  perform set_config('survey.skip_log', 'off', true);
  perform set_config('survey.internal', 'off', true);
  perform write_activity(v_ws, 'contact', p_survivor, 'merge',
    jsonb_build_object('merged', to_jsonb(v_losers), 'choices', v_choice));
end $$;

-- All contact ids that are p_contact_id or were merged into it, transitively.
create or replace function contact_family(p_contact_id uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive fam(id) as (
    select p_contact_id
    union
    select c.id from contacts c join fam f on c.merged_into = f.id
  )
  select array_agg(id) from fam;
$$;

-- 'hard' deletes everything about the person; 'anonymize' keeps responses for
-- aggregates and tombstones the contact (field list in docs/04 section 7.4).
-- Accepts an alias id. Returns the storage_deletions rows it enqueued; the
-- route deletes those objects at once and marks them done.
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

-- GDPR export for one respondent (docs/04 section 7.3), editor and above.
-- Files are listed by storage path; the route signs download URLs.
create or replace function export_respondent_data(p_contact_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  uuid;
  c     contacts;
  v_all uuid[];
  v_out jsonb;
begin
  v_id := coalesce((select a.contact_id from contact_aliases a where a.alias_id = p_contact_id), p_contact_id);
  for i in 1..10 loop
    select * into c from contacts where id = v_id;
    exit when c.id is null or c.merged_into is null;
    v_id := c.merged_into;
  end loop;
  if c.id is null or not is_member(c.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  v_all := contact_family(c.id);
  select jsonb_build_object(
    'exported_at', now(),
    'workspace', (select name from workspaces where id = c.workspace_id),
    'contact', jsonb_build_object('email', c.email, 'phone', c.phone, 'first_name', c.first_name,
                                  'last_name', c.last_name, 'company', c.company, 'custom', c.custom,
                                  'tags', to_jsonb(c.tags), 'lead_status', c.lead_status, 'status', c.status),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('created_at', n.created_at, 'body', n.body) order by n.created_at)
                         from contact_notes n where n.contact_id = any (v_all)), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object(
        'survey', s.title, 'version', v.version_no, 'status', r.status, 'started_at', r.started_at,
        'submitted_at', r.submitted_at, 'metadata', r.metadata,
        'answers', coalesce((select jsonb_agg(jsonb_build_object(
              'question_key', a.question_key, 'label', q.label,
              'value', coalesce(to_jsonb(a.value_text), to_jsonb(a.value_number), to_jsonb(a.value_date), a.value_json))
              order by q.position)
            from answers a left join questions q on q.survey_version_id = r.survey_version_id and q.question_key = a.question_key
            where a.response_id = r.id), '[]'::jsonb))
        order by coalesce(r.submitted_at, r.started_at))
      from responses r join surveys s on s.id = r.survey_id join survey_versions v on v.id = r.survey_version_id
      where r.contact_id = any (v_all)), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('question_key', f.question_key, 'name', f.original_name,
                                                           'path', f.object_path))
                         from response_files f join responses r on r.id = f.response_id
                        where r.contact_id = any (v_all)), '[]'::jsonb))
  into v_out;
  perform write_activity(c.workspace_id, 'contact', c.id, 'gdpr_export', '{}');
  return v_out;
end $$;

grant execute on function merge_contacts(uuid, uuid[], jsonb), erase_respondent(uuid, text),
  export_respondent_data(uuid) to authenticated;
