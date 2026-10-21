-- 0016: pg_cron schedules for pure SQL housekeeping (R3). Nothing here
-- touches Storage; Vercel Cron owns retention, purge and the storage sweep.
-- Spec: docs/01-data-model.md section 13.

-- Roll events older than 180 days into event_daily, then delete them.
create or replace function rollup_old_events() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cut timestamptz := date_trunc('day', now() - interval '180 days');
begin
  insert into event_daily as d (workspace_id, survey_id, survey_version_id, day, type, question_key, count, distinct_rids)
  select e.workspace_id, e.survey_id, e.survey_version_id, (e.occurred_at at time zone 'utc')::date, e.type,
         coalesce(e.question_key, ''), count(*), count(distinct e.respondent_hash)
  from events e
  where e.occurred_at < v_cut
  group by 1, 2, 3, 4, 5, 6
  on conflict (survey_version_id, day, type, question_key) do update
    set count = d.count + excluded.count, distinct_rids = d.distinct_rids + excluded.distinct_rids;
  delete from events where occurred_at < v_cut;
end $$;

-- workspaces.storage_bytes_used from storage.objects (read only).
create or replace function reconcile_storage_bytes() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('survey.internal', 'on', true);
  update workspaces w
     set storage_bytes_used = coalesce(u.bytes, 0), storage_reconciled_at = now()
    from (select w2.id,
                 (select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                   where o.bucket_id in ('public-assets', 'response-files', 'exports', 'imports')
                     and o.name like w2.id::text || '/%') as bytes
            from workspaces w2) u
   where u.id = w.id;
  perform set_config('survey.internal', 'off', true);
end $$;

select cron.schedule('prune_rate_limits', '*/15 * * * *',
  $$delete from public.rate_limit_events where at < now() - interval '2 hours'$$);
select cron.schedule('prune_idempotency', '17 * * * *',
  $$delete from public.submission_idempotency where created_at < now() - interval '24 hours'$$);
select cron.schedule('prune_aliases', '23 3 * * *',
  $$delete from public.survey_aliases where retired_at < now() - interval '30 days'$$);
select cron.schedule('expire_resume_tokens', '31 3 * * *',
  $$update public.responses set resume_token_hash = null
      where status = 'partial' and resume_token_hash is not null and started_at < now() - interval '30 days'$$);
select cron.schedule('rollup_events', '0 2 * * *', $$select public.rollup_old_events()$$);
select cron.schedule('prune_activity_log', '45 4 * * 0',
  $$delete from public.activity_log where created_at < now() - interval '400 days'$$);
select cron.schedule('prune_slug_history', '37 3 * * *',
  $$delete from public.workspace_slug_history where released_at < now() - interval '30 days'$$);
select cron.schedule('reconcile_storage_bytes', '15 5 * * *', $$select public.reconcile_storage_bytes()$$);
select cron.schedule('prune_storage_deletions', '50 5 * * *',
  $$delete from public.storage_deletions where done_at is not null and done_at < now() - interval '7 days'$$);
