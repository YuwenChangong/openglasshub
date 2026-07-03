alter table public.forum_notifications
  drop constraint if exists forum_notifications_type_check;

alter table public.forum_notifications
  add constraint forum_notifications_type_check
  check (
    type in (
      'comment_on_post',
      'reply_to_comment',
      'post_like',
      'comment_like',
      'post_moderated',
      'comment_moderated',
      'user_warned',
      'user_restricted'
    )
  );

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
