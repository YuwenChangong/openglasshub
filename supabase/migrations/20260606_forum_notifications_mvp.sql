create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint forum_notifications_type_check
    check (type in ('comment_on_post', 'reply_to_comment', 'post_like', 'comment_like'))
);

create index if not exists forum_notifications_recipient_read_created_idx
  on public.forum_notifications (recipient_id, read_at, created_at desc);

create index if not exists forum_notifications_recipient_created_idx
  on public.forum_notifications (recipient_id, created_at desc);

create index if not exists forum_notifications_post_idx
  on public.forum_notifications (post_id);

create index if not exists forum_notifications_comment_idx
  on public.forum_notifications (comment_id);

create index if not exists forum_notifications_actor_idx
  on public.forum_notifications (actor_id);

create unique index if not exists forum_notifications_post_like_unique
  on public.forum_notifications (recipient_id, actor_id, type, post_id)
  where type = 'post_like' and actor_id is not null and post_id is not null;

create unique index if not exists forum_notifications_comment_like_unique
  on public.forum_notifications (recipient_id, actor_id, type, comment_id)
  where type = 'comment_like' and actor_id is not null and comment_id is not null;

create or replace function public.enforce_forum_notification_read_update()
returns trigger
language plpgsql
as $$
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

  return new;
end;
$$;

drop trigger if exists trg_forum_notifications_read_update on public.forum_notifications;
create trigger trg_forum_notifications_read_update
before update on public.forum_notifications
for each row execute function public.enforce_forum_notification_read_update();

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
set search_path = public
as $$
begin
  if p_recipient_id is null or p_type is null then
    return;
  end if;

  if p_actor_id is not null and p_actor_id = p_recipient_id then
    return;
  end if;

  if p_type = 'post_like' then
    insert into public.forum_notifications (
      recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at
    )
    values (
      p_recipient_id, p_actor_id, p_type, p_post_id, null, p_circle_id, null, now()
    )
    on conflict (recipient_id, actor_id, type, post_id)
    where type = 'post_like' and actor_id is not null and post_id is not null
    do update set read_at = null, created_at = now();
    return;
  end if;

  if p_type = 'comment_like' then
    insert into public.forum_notifications (
      recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at
    )
    values (
      p_recipient_id, p_actor_id, p_type, p_post_id, p_comment_id, p_circle_id, null, now()
    )
    on conflict (recipient_id, actor_id, type, comment_id)
    where type = 'comment_like' and actor_id is not null and comment_id is not null
    do update set read_at = null, created_at = now();
    return;
  end if;

  insert into public.forum_notifications (
    recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at
  )
  values (
    p_recipient_id, p_actor_id, p_type, p_post_id, p_comment_id, p_circle_id, null, now()
  );
end;
$$;

create or replace function public.notify_comment_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_author_id uuid;
  target_parent_author_id uuid;
begin
  if new.status <> 'published' then
    return new;
  end if;

  select p.author_id
  into target_post_author_id
  from public.posts p
  where p.id = new.post_id;

  perform public.insert_forum_notification(
    target_post_author_id,
    new.author_id,
    'comment_on_post',
    new.post_id,
    new.id,
    null
  );

  if new.parent_id is not null then
    select c.author_id
    into target_parent_author_id
    from public.comments c
    where c.id = new.parent_id;

    perform public.insert_forum_notification(
      target_parent_author_id,
      new.author_id,
      'reply_to_comment',
      new.post_id,
      new.id,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_comments_notify_created on public.comments;
create trigger trg_comments_notify_created
after insert on public.comments
for each row execute function public.notify_comment_created();

create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_author_id uuid;
begin
  if new.vote <> 1 then
    return new;
  end if;

  select p.author_id
  into target_post_author_id
  from public.posts p
  where p.id = new.post_id;

  perform public.insert_forum_notification(
    target_post_author_id,
    new.user_id,
    'post_like',
    new.post_id,
    null,
    null
  );

  return new;
end;
$$;

drop trigger if exists trg_post_votes_notify on public.post_votes;
create trigger trg_post_votes_notify
after insert or update on public.post_votes
for each row execute function public.notify_post_like();

create or replace function public.notify_comment_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_comment_author_id uuid;
  target_post_id uuid;
begin
  if new.reaction_type <> 'like' then
    return new;
  end if;

  select c.author_id, c.post_id
  into target_comment_author_id, target_post_id
  from public.comments c
  where c.id = new.comment_id;

  perform public.insert_forum_notification(
    target_comment_author_id,
    new.user_id,
    'comment_like',
    target_post_id,
    new.comment_id,
    null
  );

  return new;
end;
$$;

drop trigger if exists trg_comment_reactions_notify on public.comment_reactions;
create trigger trg_comment_reactions_notify
after insert or update on public.comment_reactions
for each row execute function public.notify_comment_like();

alter table public.forum_notifications enable row level security;

drop policy if exists "forum_notifications_select_own" on public.forum_notifications;
create policy "forum_notifications_select_own"
on public.forum_notifications
for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists "forum_notifications_update_own" on public.forum_notifications;
create policy "forum_notifications_update_own"
on public.forum_notifications
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists "forum_notifications_delete_own" on public.forum_notifications;
create policy "forum_notifications_delete_own"
on public.forum_notifications
for delete
to authenticated
using (recipient_id = auth.uid());

grant select, update, delete on table public.forum_notifications to authenticated;
