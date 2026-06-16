-- Fix notification re-like conflicts so the existing read_at-only update guard remains valid.

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

  if p_type = 'post_like' then
    insert into public.forum_notifications (
      recipient_id, actor_id, type, post_id, comment_id, circle_id, read_at, created_at
    )
    values (
      p_recipient_id, p_actor_id, p_type, p_post_id, null, p_circle_id, null, now()
    )
    on conflict (recipient_id, actor_id, type, post_id)
    where type = 'post_like' and actor_id is not null and post_id is not null
    do update set read_at = null;
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
    do update set read_at = null;
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
