do $$
begin
  if exists (
    select 1
    from pg_type
    where typname = 'report_target_type'
  ) then
    begin
      alter type public.report_target_type add value if not exists 'circle';
    exception when duplicate_object then null;
    end;
    begin
      alter type public.report_target_type add value if not exists 'user';
    exception when duplicate_object then null;
    end;
  end if;

  if exists (
    select 1
    from pg_type
    where typname = 'report_status'
  ) then
    begin
      alter type public.report_status add value if not exists 'reviewing';
    exception when duplicate_object then null;
    end;
    begin
      alter type public.report_status add value if not exists 'actioned';
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- Preflight orphan audit (read-only; run manually before/after migration if needed):
-- select id, target_type, target_id, status, created_at
-- from public.reports
-- where
--   (target_type = 'post' and not exists (select 1 from public.posts p where p.id = reports.target_id))
--   or (target_type = 'comment' and not exists (select 1 from public.comments c where c.id = reports.target_id))
--   or (target_type = 'circle' and not exists (select 1 from public.circles circle_row where circle_row.id = reports.target_id))
--   or (target_type = 'user' and not exists (select 1 from public.profiles profile_row where profile_row.id = reports.target_id))
-- order by created_at desc;

drop trigger if exists trg_reports_validate_target on public.reports;

alter table public.reports
  add column if not exists reason_code text,
  add column if not exists reason_text text,
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

update public.reports
set
  reason_code = coalesce(nullif(reason_code, ''), 'other'),
  reason_text = case
    when reason_text is not null and btrim(reason_text) <> '' then reason_text
    when reason is not null and btrim(reason) <> '' then reason
    else null
  end
where reason_code is null
   or btrim(reason_code) = ''
   or reason_text is null;

alter table public.reports
  alter column reason_code set default 'other',
  alter column reason_code set not null;

alter table public.reports
  drop constraint if exists reports_reason_code_check;

alter table public.reports
  add constraint reports_reason_code_check
  check (
    reason_code in (
      'spam',
      'harassment',
      'hate',
      'sexual',
      'violence',
      'illegal',
      'off_platform_contact',
      'misinformation',
      'privacy',
      'other'
    )
  );

alter table public.reports
  drop constraint if exists reports_reason_text_check;

alter table public.reports
  add constraint reports_reason_text_check
  check (
    reason_text is null
    or char_length(reason_text) between 5 and 1000
  );

alter table public.reports
  drop constraint if exists reports_priority_check;

alter table public.reports
  add constraint reports_priority_check
  check (priority in ('low', 'normal', 'high'));

create index if not exists reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);

create index if not exists reports_reason_code_status_idx
  on public.reports (reason_code, status, created_at desc);

create table if not exists public.report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_events_event_type_check
    check (
      event_type in (
        'created',
        'reviewing',
        'dismissed',
        'actioned',
        'hide_target',
        'warn_user',
        'suspend_user',
        'ban_user',
        'note'
      )
    )
);

create index if not exists report_events_report_created_idx
  on public.report_events (report_id, created_at desc);

create index if not exists report_events_actor_created_idx
  on public.report_events (actor_id, created_at desc);

alter table public.report_events enable row level security;

grant select, insert on table public.report_events to authenticated;

drop policy if exists "report_events_insert_reporter_created" on public.report_events;
create policy "report_events_insert_reporter_created"
on public.report_events
for insert
to authenticated
with check (
  event_type = 'created'
  and actor_id = auth.uid()
  and exists (
    select 1
    from public.reports
    where reports.id = report_events.report_id
      and reports.reporter_id = auth.uid()
  )
);

drop policy if exists "report_events_select_own_or_staff" on public.report_events;
create policy "report_events_select_own_or_staff"
on public.report_events
for select
to authenticated
using (
  (select public.is_moderator_or_admin())
  or exists (
    select 1
    from public.reports
    where reports.id = report_events.report_id
      and reports.reporter_id = auth.uid()
  )
);

drop policy if exists "report_events_insert_staff" on public.report_events;
create policy "report_events_insert_staff"
on public.report_events
for insert
to authenticated
with check (
  (select public.is_moderator_or_admin())
);

create or replace function public.validate_report_target()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.target_type is not distinct from old.target_type
     and new.target_id is not distinct from old.target_id then
    return new;
  end if;

  if new.target_type = 'post' and not exists (
    select 1 from public.posts p where p.id = new.target_id
  ) then
    raise exception 'report target post % not found', new.target_id;
  elsif new.target_type = 'comment' and not exists (
    select 1 from public.comments c where c.id = new.target_id
  ) then
    raise exception 'report target comment % not found', new.target_id;
  elsif new.target_type = 'circle' and not exists (
    select 1 from public.circles circle_row where circle_row.id = new.target_id
  ) then
    raise exception 'report target circle % not found', new.target_id;
  elsif new.target_type = 'user' and not exists (
    select 1 from public.profiles profile_row where profile_row.id = new.target_id
  ) then
    raise exception 'report target user % not found', new.target_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_validate_target on public.reports;
create trigger trg_reports_validate_target
before insert or update on public.reports
for each row execute function public.validate_report_target();
