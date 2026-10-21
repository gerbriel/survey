-- 0010: workspace pixels, the raw script kill switch trigger, abuse reports.
-- Spec: docs/01-data-model.md sections 2 and 9; docs/02 sections 7, 9.1; docs/05 section 7.3.

create table workspace_pixels (      -- doc 02
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type         pixel_type not null,
  value        text not null check (
                 (type = 'ga4'  and value ~ '^G-[A-Z0-9]{4,12}$') or
                 (type = 'meta' and value ~ '^[0-9]{8,20}$') or
                 (type = 'gtm'  and value ~ '^GTM-[A-Z0-9]{4,10}$') or
                 (type = 'custom_script' and length(value) <= 10000)),
  parsed       jsonb,                -- custom_script parsed into <script>/<noscript> parts at save
  label        text not null,
  enabled      boolean not null default true,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index workspace_pixels_ws on workspace_pixels (workspace_id);
create trigger workspace_pixels_touch before update on workspace_pixels
  for each row execute function touch_updated_at();

-- Kill switch (doc 05): when raw_script_pixels_allowed is false, custom_script
-- and gtm rows cannot be enabled. resolve_public_survey also omits existing ones.
create or replace function guard_workspace_pixel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.enabled and new.type in ('custom_script', 'gtm')
     and (tg_op = 'INSERT' or not old.enabled or old.type is distinct from new.type or old.value is distinct from new.value)
     and not coalesce((select l.raw_script_pixels_allowed from workspace_limits l where l.workspace_id = new.workspace_id), true) then
    raise exception 'raw_script_pixels_disabled';
  end if;
  if tg_op = 'INSERT' and not is_trusted_caller() then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.created_by is distinct from old.created_by) then
    raise exception 'workspace_id and created_by are immutable';
  end if;
  return new;
end $$;
create trigger workspace_pixels_guard before insert or update on workspace_pixels
  for each row execute function guard_workspace_pixel();
create trigger workspace_pixels_activity after insert or update or delete on workspace_pixels
  for each row execute function log_activity();

create table abuse_reports (             -- public form at /report?s={slug} (docs 02, 05)
  id               uuid primary key default gen_random_uuid(),
  survey_id        uuid references surveys(id) on delete set null,       -- null when the slug is unknown
  workspace_id     uuid references workspaces(id) on delete set null,
  slug_text        text not null check (length(slug_text) <= 100),     -- what the reporter submitted, stored as is
  reason           text not null check (reason in ('phishing','sensitive_data','harassment','other')),
  details          text check (details is null or length(details) <= 2000),
  reporter_contact text check (reporter_contact is null or length(reporter_contact) <= 200),
  ip_hash          text,          -- daily-salted HMAC, same as rate limiting; never the raw IP
  status           text not null default 'open' check (status in ('open','dismissed','actioned')),
  reviewed_by      uuid references profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index abuse_reports_open on abuse_reports (created_at desc) where status = 'open';

alter table workspace_pixels enable row level security;
alter table abuse_reports    enable row level security;

create policy workspace_pixels_select on workspace_pixels for select to authenticated using (is_member(workspace_id));
create policy workspace_pixels_insert on workspace_pixels for insert to authenticated with check (is_member(workspace_id, 'admin'));
create policy workspace_pixels_update on workspace_pixels for update to authenticated
  using (is_member(workspace_id, 'admin')) with check (is_member(workspace_id, 'admin'));
create policy workspace_pixels_delete on workspace_pixels for delete to authenticated using (is_member(workspace_id, 'admin'));

-- Written only by the /report route with the service role (no insert policy).
create policy abuse_reports_select on abuse_reports for select to authenticated using (is_platform_admin());
create policy abuse_reports_update on abuse_reports for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
