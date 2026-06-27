-- User safety state + audit events for warning / suspension / ban MVP.
-- Keeps profiles.role lockdown untouched by storing enforcement state separately.

create table if not exists public.user_safety_states (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reputation_score integer not null default 0,
  strike_count integer not null default 0 check (strike_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  status text not null default 'active',
  suspended_until timestamptz,
  banned_at timestamptz,
  ban_reason text,
  last_action_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_safety_states_status_check
    check (status in ('active', 'warned', 'suspended', 'banned'))
);

create table if not exists public.user_safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_safety_events_event_type_check
    check (event_type in ('warning', 'suspend', 'ban', 'unban', 'strike_added', 'strike_removed', 'note'))
);

create index if not exists user_safety_states_status_idx
  on public.user_safety_states (status, updated_at desc);
create index if not exists user_safety_events_user_id_created_idx
  on public.user_safety_events (user_id, created_at desc);
create index if not exists user_safety_events_actor_id_created_idx
  on public.user_safety_events (actor_id, created_at desc);

drop trigger if exists trg_user_safety_states_set_updated_at on public.user_safety_states;
create trigger trg_user_safety_states_set_updated_at
before update on public.user_safety_states
for each row execute function public.set_updated_at();

alter table public.user_safety_states enable row level security;
alter table public.user_safety_events enable row level security;

revoke select on public.user_safety_states from authenticated;
grant select (
  user_id,
  reputation_score,
  strike_count,
  warning_count,
  status,
  suspended_until,
  banned_at,
  ban_reason,
  last_action_at,
  created_at,
  updated_at
) on public.user_safety_states to authenticated;
grant insert, update on public.user_safety_states to authenticated;
grant select on public.user_safety_events to authenticated;
grant insert on public.user_safety_events to authenticated;

drop policy if exists "user_safety_states_select_self" on public.user_safety_states;
create policy "user_safety_states_select_self"
on public.user_safety_states
for select
to authenticated
using (
  user_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "user_safety_states_insert_staff" on public.user_safety_states;
create policy "user_safety_states_insert_staff"
on public.user_safety_states
for insert
to authenticated
with check (
  (select public.is_moderator_or_admin())
);

drop policy if exists "user_safety_states_update_staff" on public.user_safety_states;
create policy "user_safety_states_update_staff"
on public.user_safety_states
for update
to authenticated
using (
  (select public.is_moderator_or_admin())
)
with check (
  (select public.is_moderator_or_admin())
);

drop policy if exists "user_safety_events_select_staff" on public.user_safety_events;
create policy "user_safety_events_select_staff"
on public.user_safety_events
for select
to authenticated
using (
  (select public.is_moderator_or_admin())
);

drop policy if exists "user_safety_events_insert_staff" on public.user_safety_events;
create policy "user_safety_events_insert_staff"
on public.user_safety_events
for insert
to authenticated
with check (
  (select public.is_moderator_or_admin())
);
