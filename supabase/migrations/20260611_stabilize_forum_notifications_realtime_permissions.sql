alter table public.forum_notifications
  add column if not exists last_event_at timestamptz;

update public.forum_notifications
set last_event_at = created_at
where last_event_at is null;

alter table public.forum_notifications
  alter column last_event_at set default now();

alter table public.forum_notifications
  alter column last_event_at set not null;

create index if not exists forum_notifications_recipient_event_idx
  on public.forum_notifications (recipient_id, last_event_at desc, created_at desc);

create or replace function public.enforce_forum_notification_read_update()
returns trigger
language plpgsql
as $$
declare
  internal_update_enabled boolean := current_setting('app.notification_internal_update', true) = '1';
begin
  if new.recipient_id is distinct from old.recipient_id
     or new.actor_id is distinct from old.actor_id
     or new.type is distinct from old.type
     or new.post_id is distinct from old.post_id
     or new.comment_id is distinct from old.comment_id
     or new.circle_id is distinct from old.circle_id
     or new.created_at is distinct from old.created_at then
    raise exception 'forum_notifications only allow read_at updates';
  end if;

  if not internal_update_enabled and new.last_event_at is distinct from old.last_event_at then
    raise exception 'forum_notifications only allow read_at updates';
  end if;

  return new;
end;
$$;

create or replace function public.insert_forum_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type text,
  p_post_id uuid default null,
  p_comment_id uuid default null,
  p_circle_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient_id is null or p_type is null then
    return;
  end if;

  if p_actor_id is not null and p_actor_id = p_recipient_id then
    return;
  end if;

  perform set_config('app.notification_internal_update', '1', true);

  if p_type = 'post_like' then
    insert into public.forum_notifications (
      recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at, last_event_at
    )
    values (
      p_recipient_id, p_actor_id, p_type, p_post_id, null, p_circle_id, null, now(), now()
    )
    on conflict (recipient_id, actor_id, type, post_id)
    where type = 'post_like' and actor_id is not null and post_id is not null
    do update
      set read_at = null,
          last_event_at = now();
    return;
  end if;

  if p_type = 'comment_like' then
    insert into public.forum_notifications (
      recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at, last_event_at
    )
    values (
      p_recipient_id, p_actor_id, p_type, p_post_id, p_comment_id, p_circle_id, null, now(), now()
    )
    on conflict (recipient_id, actor_id, type, comment_id)
    where type = 'comment_like' and actor_id is not null and comment_id is not null
    do update
      set read_at = null,
          last_event_at = now();
    return;
  end if;

  insert into public.forum_notifications (
    recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at, last_event_at
  )
  values (
    p_recipient_id, p_actor_id, p_type, p_post_id, p_comment_id, p_circle_id, null, now(), now()
  );
end;
$$;

alter table if exists public.forum_notifications replica identity full;
alter table if exists public.comments replica identity full;
alter table if exists public.post_votes replica identity full;
alter table if exists public.comment_reactions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_notifications'
    ) then
      alter publication supabase_realtime add table public.forum_notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
    ) then
      alter publication supabase_realtime add table public.comments;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_votes'
    ) then
      alter publication supabase_realtime add table public.post_votes;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comment_reactions'
    ) then
      alter publication supabase_realtime add table public.comment_reactions;
    end if;
  end if;
end $$;
