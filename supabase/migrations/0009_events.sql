-- 0009: analytics events, daily rollup, stopwords (seeded here), record_events.
-- Spec: docs/01-data-model.md section 7; docs/04 section 3.

create table events (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  response_id       uuid references responses(id) on delete set null,
  respondent_hash   text,
  type              text not null check (type in ('view','start','question_view','question_answer',
                                     'page_next','page_back','complete','abandon','file_upload')),
  question_key      text,
  occurred_at       timestamptz not null default now(),
  meta              jsonb not null default '{}'
);
create index events_survey_time  on events (survey_id, occurred_at);
create index events_version_time on events (survey_version_id, occurred_at);
create index events_version_type on events (survey_version_id, type);
create index events_rid          on events (survey_id, respondent_hash);
create index events_response     on events (response_id) where response_id is not null;
create index events_time_brin    on events using brin (occurred_at);

create table event_daily (           -- doc 04 rollup of events older than 180 days
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  day               date not null,
  type              text not null,
  question_key      text not null default '',     -- '' for survey-level events
  count             int not null,
  distinct_rids     int not null,
  primary key (survey_version_id, day, type, question_key)
);
create index event_daily_survey on event_daily (survey_id, day);

create table stopwords (             -- doc 04 word frequency, seeded in the migration
  lang text not null,
  word text not null,
  primary key (lang, word)
);

insert into stopwords (lang, word)
select 'en', w from unnest(array[
  'a','about','above','after','again','against','all','also','am','an','and','any','are','as','at','be','because',
  'been','before','being','below','between','both','but','by','can','could','did','do','does','doing','done','down',
  'during','each','even','ever','every','few','for','from','further','get','got','had','has','have','having','he',
  'her','here','hers','herself','him','himself','his','how','however','i','if','in','into','is','it','its','itself',
  'just','like','made','make','many','may','me','might','more','most','much','must','my','myself','no','nor','not',
  'now','of','off','on','once','one','only','or','other','our','ours','ourselves','out','over','own','really','same',
  'she','should','so','some','such','than','that','the','their','theirs','them','themselves','then','there','these',
  'they','thing','things','this','those','through','to','too','under','until','up','us','very','was','we','well',
  'were','what','when','where','which','while','who','whom','why','will','with','would','yes','yet','you','your',
  'yours','yourself','yourselves','dont','didnt','doesnt','isnt','wasnt','im','ive','its','thats','theres','cant',
  'wont','would','could','should','lot','lots','bit','also','still','way','much','get','go','going','know','think'
]) w
on conflict do nothing;

-- Beacon writes (service role only). p_events: array of at most 50 objects
-- {survey_id, survey_version_id, respondent_hash, type, question_key,
-- occurred_at, meta}. Unknown types, 'complete' (emitted only by
-- submit_response), versions that are not published versions of the survey,
-- and surveys that do not resolve publicly are dropped silently. occurred_at is
-- clamped to 10 minutes of server time. Returns the number inserted.
create or replace function record_events(p_events jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_events) > 50 then
    raise exception 'too_many_events';
  end if;
  with raw as (
    select e
    from jsonb_array_elements(p_events) e
    where jsonb_typeof(e) = 'object'
      and e ->> 'type' in ('view','start','question_view','question_answer','page_next','page_back','abandon','file_upload')
      and coalesce(e ->> 'survey_id', '') ~ '^[0-9a-f-]{36}$'
      and coalesce(e ->> 'survey_version_id', '') ~ '^[0-9a-f-]{36}$'
  ), ins as (
    insert into events (workspace_id, survey_id, survey_version_id, respondent_hash, type, question_key, occurred_at, meta)
    select s.workspace_id, s.id, v.id,
           left(r.e ->> 'respondent_hash', 64),
           r.e ->> 'type',
           case when (r.e ->> 'question_key') ~ '^q_[a-z0-9]{8}$' then r.e ->> 'question_key' end,
           least(greatest(coalesce(case when (r.e ->> 'occurred_at') ~ '^\d{4}-\d{2}-\d{2}T'
                                        then (r.e ->> 'occurred_at')::timestamptz end, now()),
                          now() - interval '10 minutes'), now() + interval '10 minutes'),
           case when jsonb_typeof(r.e -> 'meta') = 'object' and octet_length((r.e -> 'meta')::text) <= 2048
                then r.e -> 'meta' else '{}'::jsonb end
    from raw r
    join surveys s on s.id = (r.e ->> 'survey_id')::uuid
    join workspaces w on w.id = s.workspace_id and w.deleted_at is null
    join survey_versions v on v.id = (r.e ->> 'survey_version_id')::uuid and v.survey_id = s.id and v.status = 'published'
    where (select st.state from survey_effective_state(s, w.archived_at is not null) st) <> 'draft'
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;
grant execute on function record_events(jsonb) to service_role;

alter table events      enable row level security;
alter table event_daily enable row level security;
alter table stopwords   enable row level security;

create policy events_select on events for select to authenticated using (is_member(workspace_id));
create policy event_daily_select on event_daily for select to authenticated using (is_member(workspace_id));
create policy stopwords_select on stopwords for select to authenticated using (true);
