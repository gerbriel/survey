-- 0013: reports, report widgets, public share links, export jobs,
-- filtered_responses, version_questions, shared_report_payload.
-- Spec: docs/01-data-model.md section 8; docs/04 sections 4, 5, 6.

create table reports (               -- doc 04
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  survey_id    uuid not null references surveys(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  is_default   boolean not null default false,   -- materialized default report
  filters      jsonb not null default '{}',
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index reports_one_default on reports (survey_id) where is_default;
create index reports_survey on reports (survey_id);
create trigger reports_touch before update on reports
  for each row execute function touch_updated_at();

create table report_widgets (        -- doc 04
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references reports(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,  -- denormalized for RLS
  position      int not null,
  question_key  text,
  metric        text,                -- funnel metric when question_key is null
  chart_type    text not null check (chart_type in ('bar','stacked_bar','pie','table','histogram',
                                     'nps_gauge','heat_table','word_list','line','stat')),
  cross_tab_key text,
  options       jsonb not null default '{}',
  check ((question_key is null) <> (metric is null))
);
create index report_widgets_report on report_widgets (report_id, position);

create table report_shares (         -- doc 04 public share links, read only via shared_report_payload
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references reports(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  token          text not null unique default gen_token(16),   -- /r/{token}
  expires_at     timestamptz default now() + interval '30 days',  -- null = no expiry
  password_hash  text,                 -- crypt() bcrypt
  revoked_at     timestamptz,
  created_by     uuid references profiles(id) on delete set null,
  view_count     int not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create index report_shares_report on report_shares (report_id);

create table export_jobs (           -- doc 04 large exports
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  survey_id    uuid references surveys(id) on delete cascade,
  kind         text not null check (kind in ('responses','contacts')),
  format       text not null check (format in ('csv','xlsx')),
  filters      jsonb not null default '{}',
  status       text not null default 'pending' check (status in ('pending','running','done','failed')),
  cursor       jsonb,                -- resume point when a run hits maxDuration
  storage_path text,                 -- exports/{workspace_id}/{id}.{format}, nulled after 7 days
  row_count    int,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index export_jobs_ws on export_jobs (workspace_id, created_at desc);

create trigger reports_activity after insert or update or delete on reports
  for each row execute function log_activity();
create trigger report_shares_activity after insert or update or delete on report_shares
  for each row execute function log_activity();

-- Clients may only revoke a share or change its expiry and password.
create or replace function guard_report_share() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_trusted_caller() or flag_on('survey.internal') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.view_count := 0; new.last_viewed_at := null; new.revoked_at := null; new.created_by := auth.uid();
    return new;
  end if;
  if new.report_id <> old.report_id or new.workspace_id <> old.workspace_id or new.token <> old.token
     or new.view_count <> old.view_count or new.created_by is distinct from old.created_by then
    raise exception 'Only revoked_at, expires_at and password_hash can change on a share';
  end if;
  return new;
end $$;
create trigger report_shares_guard before insert or update on report_shares
  for each row execute function guard_report_share();

-- ---------------------------------------------------------------------------
-- Report helpers. SECURITY INVOKER: RLS applies to the caller.
-- ---------------------------------------------------------------------------

-- Question snapshot of a version in order.
create or replace function version_questions(p_version_id uuid) returns setof questions
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from questions where survey_version_id = p_version_id order by position;
$$;

-- Filters (docs/04 section 4.3), all optional:
--   from, to (timestamps on coalesce(submitted_at, started_at))
--   version: 'latest' (default) | 'all' | a version uuid
--   status: 'complete' (default) | 'all'
--   identity: 'all' (default) | 'token' | 'identified' | 'anonymous'
--   contact: {lead_status[], tags[], owner_ids[]}  (excludes anonymous responses)
--   answers: [{question_key, any_of[]} | {question_key, min, max}]
create or replace function filtered_responses(p_survey_id uuid, p_filters jsonb default '{}')
returns setof responses language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_latest uuid;
begin
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
               or c.owner_id::text in (select jsonb_array_elements_text(f #> '{contact,owner_ids}')))))
    and (f -> 'answers' is null or not exists (
          select 1 from jsonb_array_elements(f -> 'answers') af
          where not exists (
            select 1 from answers a
            where a.response_id = r.id and a.question_key = af ->> 'question_key'
              and (af -> 'any_of' is null
                   or a.value_text in (select jsonb_array_elements_text(af -> 'any_of'))
                   or a.value_json ?| array(select jsonb_array_elements_text(af -> 'any_of')))
              and (af ->> 'min' is null or a.value_number >= (af ->> 'min')::numeric)
              and (af ->> 'max' is null or a.value_number <= (af ->> 'max')::numeric))));
end $$;

grant execute on function version_questions(uuid), filtered_responses(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public share payload (docs/04 section 5.4). Service role only. Derives
-- report, survey and workspace from the share row; returns aggregates only.
-- Counts under 3 are returned as null with "suppressed": true. Returns null
-- for an unknown, revoked or expired token or a wrong password, so the route
-- answers the same 404 for all of them.
-- ---------------------------------------------------------------------------
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
              from pg_temp.rw_answers a, jsonb_array_elements_text(a.value_json) with ordinality e
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
  select * into sh from report_shares where token = p_token for update;
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

  perform set_config('survey.internal', 'on', true);
  update report_shares set view_count = view_count + 1, last_viewed_at = now() where id = sh.id;
  perform set_config('survey.internal', 'off', true);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rw.id, 'position', rw.position, 'chart_type', rw.chart_type,
           'question_key', rw.question_key, 'metric', rw.metric,
           'label', (select q.label from questions q where q.survey_version_id = s.latest_published_version_id
                     and q.question_key = rw.question_key),
           'options', (select q.options from questions q where q.survey_version_id = s.latest_published_version_id
                       and q.question_key = rw.question_key),
           'result', report_widget_data(s.id, rep.filters, rw.question_key, rw.metric))
         order by rw.position), '[]')
    into v_widgets
    from report_widgets rw where rw.report_id = rep.id;

  return jsonb_build_object(
    'report', jsonb_build_object('name', rep.name),
    'survey', jsonb_build_object('title', s.title),
    'workspace', jsonb_build_object('name', w.name, 'logo_path', w.logo_path),
    'widgets', v_widgets);
end $$;
grant execute on function shared_report_payload(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table reports        enable row level security;
alter table report_widgets enable row level security;
alter table report_shares  enable row level security;
alter table export_jobs    enable row level security;

create policy reports_select on reports for select to authenticated using (is_member(workspace_id));
create policy reports_insert on reports for insert to authenticated
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from surveys s where s.id = survey_id and s.workspace_id = reports.workspace_id));
create policy reports_update on reports for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));
create policy reports_delete on reports for delete to authenticated using (is_member(workspace_id, 'editor'));

create policy report_widgets_select on report_widgets for select to authenticated using (is_member(workspace_id));
create policy report_widgets_insert on report_widgets for insert to authenticated
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from reports r where r.id = report_id and r.workspace_id = report_widgets.workspace_id));
create policy report_widgets_update on report_widgets for update to authenticated
  using (is_member(workspace_id, 'editor'))
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from reports r where r.id = report_id and r.workspace_id = report_widgets.workspace_id));
create policy report_widgets_delete on report_widgets for delete to authenticated using (is_member(workspace_id, 'editor'));

create policy report_shares_select on report_shares for select to authenticated using (is_member(workspace_id, 'editor'));
create policy report_shares_insert on report_shares for insert to authenticated
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from reports r where r.id = report_id and r.workspace_id = report_shares.workspace_id));
create policy report_shares_update on report_shares for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));
create policy report_shares_delete on report_shares for delete to authenticated using (is_member(workspace_id, 'editor'));

create policy export_jobs_select on export_jobs for select to authenticated
  using ((created_by = auth.uid() and is_member(workspace_id)) or is_member(workspace_id, 'admin'));
create policy export_jobs_insert on export_jobs for insert to authenticated
  with check (is_member(workspace_id, 'editor') and created_by = auth.uid() and status = 'pending'
              and storage_path is null and row_count is null
              and (survey_id is null
                   or exists (select 1 from surveys s where s.id = survey_id and s.workspace_id = export_jobs.workspace_id)));
