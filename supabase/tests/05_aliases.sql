-- Survey aliases: reserved words, slug lookalikes, one active alias, the 30
-- day hold after a rename, and the anon read path (resolve_public_survey,
-- get_public_definition).
begin;

-- The reserved list, printed one per line for a TS test to compare against
-- DASHBOARD_SEGMENTS in src/lib/hosts.ts and the doc 02 list:
--   psql "$DB_URL" -At -c 'select unnest(public.reserved_public_segments()) order by 1'
select unnest(public.reserved_public_segments()) as reserved_public_segment order by 1;

do $$
declare
  v_required text[] := array[
    -- DASHBOARD_SEGMENTS in src/lib/hosts.ts
    'w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev',
    -- docs/02 section 2
    'api', 's', 'app', 'www', 'static', 'well-known', 'report', 'privacy', 'robots', 'favicon',
    -- docs/01 section 3
    'r', 'f', 'e', 'logout', 'join'];
  v_missing text[];
begin
  select array_agg(x) into v_missing from unnest(v_required) x where not (x = any (public.reserved_public_segments()));
  assert v_missing is null, format('reserved_public_segments() is missing %s', v_missing);
end $$;

select tests.new_user('owner');
select tests.new_user('editor1');
select tests.new_workspace('acme', tests.id('owner'));
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.published_survey('spring', tests.id('acme'), 'editor1');
select tests.published_survey('other', tests.id('acme'), 'editor1');

-- The check constraint itself rejects every reserved word (direct insert as postgres)
do $$
declare v_word text;
begin
  foreach v_word in array array['report', 'privacy', 'robots', 'favicon', 'admin', 'login', 'pending', 'invite',
                                'auth', 'dev', 'api', 'static', 'well-known', 'logout', 'join', 'www', 'app'] loop
    assert tests.err(format('insert into public.survey_aliases (survey_id, workspace_id, alias) values (%L, %L, %L)',
                            tests.id('spring'), tests.id('acme'), v_word)) like '%violates check constraint%',
      format('reserved alias %s accepted', v_word);
  end loop;
  assert tests.err(format('insert into public.survey_aliases (survey_id, workspace_id, alias) values (%L, %L, %L)',
                          tests.id('spring'), tests.id('acme'), 'abcde12345')) like '%violates check constraint%',
    'slug lookalike accepted';
end $$;

select tests.as_user('editor1');
do $$ begin
  assert tests.err($q$select public.set_survey_alias(tests.id('spring'), 'report')$q$) = 'alias_reserved', 'fn reserved';
  assert tests.err($q$select public.set_survey_alias(tests.id('spring'), 'Spring Fair!')$q$) = 'alias_invalid', 'fn invalid';
  perform public.set_survey_alias(tests.id('spring'), 'Spring-Fair');   -- stored lowercase
  assert (select alias from public.survey_aliases where survey_id = tests.id('spring') and retired_at is null) = 'spring-fair',
    'alias set';
  assert tests.err($q$select public.set_survey_alias(tests.id('other'), 'spring-fair')$q$) = 'alias_taken', 'live alias taken';
  -- rename: old alias retired and held
  perform public.set_survey_alias(tests.id('spring'), 'summer-fair');
  assert tests.err($q$select public.set_survey_alias(tests.id('other'), 'spring-fair')$q$) = 'alias_taken',
    'retired alias is held for 30 days';
end $$;

-- Anon resolution: slug, alias, retired alias inside the hold, unknown key
reset role;
select tests.clear_claims();
select set_config('tests.spring_slug', (select slug from public.surveys where id = tests.id('spring')), true);
select tests.as_anon();
do $$
declare r record;
begin
  select * into r from public.resolve_public_survey(current_setting('tests.spring_slug'));
  assert r.matched_by = 'slug' and r.effective_state = 'open' and r.version_id = tests.id('spring_v1')
     and r.alias = 'summer-fair', 'slug resolves';
  select * into r from public.resolve_public_survey('SUMMER-FAIR');
  assert r.matched_by = 'alias' and r.survey_id = tests.id('spring'), 'alias resolves case-insensitively';
  select * into r from public.resolve_public_survey('spring-fair');
  assert r.matched_by = 'retired_alias' and r.survey_id = tests.id('spring'), 'retired alias keeps resolving';
  assert (select count(*) from public.resolve_public_survey('unknown-key')) = 0, 'unknown key: no rows';
  assert (select count(*) from public.resolve_public_survey('')) = 0, 'empty key: no rows';
  assert (select count(*) from public.get_public_definition(tests.id('spring_v1'), 'summer-fair')) = 1, 'public definition';
  assert (select count(*) from public.get_public_definition(tests.id('spring_v1'), 'unknown-key')) = 0,
    'definition needs a valid key';
  assert (select count(*) from public.get_public_definition(tests.id('other_v1'), 'summer-fair')) = 0,
    'version must belong to the keyed survey';
end $$;

-- Hold expiry: after 30 days the retired alias stops resolving; once pruned it is free
reset role;
select tests.clear_claims();
update public.survey_aliases set retired_at = now() - interval '31 days' where alias = 'spring-fair';
select tests.as_anon();
do $$ begin
  assert (select count(*) from public.resolve_public_survey('spring-fair')) = 0, 'expired hold resolves to nothing';
end $$;
reset role;
select tests.clear_claims();
delete from public.survey_aliases where retired_at < now() - interval '30 days';   -- the prune_aliases cron job
select tests.as_user('editor1');
do $$ begin
  perform public.set_survey_alias(tests.id('other'), 'spring-fair');
  assert (select survey_id from public.survey_aliases where alias = 'spring-fair') = tests.id('other'), 'freed after prune';
  -- taking back your own retired alias un-retires it
  perform public.set_survey_alias(tests.id('spring'), 'autumn-fair');
  perform public.set_survey_alias(tests.id('spring'), 'summer-fair');
  assert (select retired_at from public.survey_aliases where alias = 'summer-fair') is null, 'own alias un-retired';
  assert (select count(*) from public.survey_aliases where survey_id = tests.id('spring') and retired_at is null) = 1,
    'one active alias';
end $$;

-- Draft and closed states
select tests.as_user('editor1');
update public.surveys set state = 'draft' where id = tests.id('other');
update public.surveys set state = 'closed', closed_message = 'Thanks, we are full.' where id = tests.id('spring');
select tests.as_anon();
do $$
declare r record;
begin
  assert (select count(*) from public.resolve_public_survey('spring-fair')) = 0, 'draft survey resolves to nothing';
  select * into r from public.resolve_public_survey('summer-fair');
  assert r.effective_state = 'closed' and r.state_reason = 'manual' and r.version_id is null
     and r.closed_message = 'Thanks, we are full.' and r.pixels = '[]'::jsonb, 'closed survey';
  assert (select count(*) from public.get_public_definition(tests.id('spring_v1'), 'summer-fair')) = 0,
    'closed survey serves no definition';
end $$;

rollback;
