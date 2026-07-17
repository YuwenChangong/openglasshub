-- Bind uploaded media paths to both the authenticated actor and the target post.
-- Forward-only remediation for post-media temporary-object provenance.

create or replace function public.is_canonical_post_media_object_key(
  object_key text,
  actor_id uuid,
  target_post_id uuid,
  allow_temporary boolean
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    object_key is not null
    and position('?' in object_key) = 0
    and position('#' in object_key) = 0
    and position('%' in object_key) = 0
    and position(chr(92) in object_key) = 0
    and (
      object_key ~ ('^' || actor_id::text || '/' || target_post_id::text || '/[^/]+$')
      or (
        allow_temporary
        and object_key ~ ('^tmp/' || actor_id::text || '/' || target_post_id::text || '/[^/]+$')
      )
    );
$$;

create or replace function public.can_bind_post_media_provenance(
  media_kind text,
  media_storage_path text,
  media_url text,
  actor_id uuid,
  target_post_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when media_kind = 'image' then public.is_canonical_post_media_object_key(media_storage_path, actor_id, target_post_id, false)
    when media_kind = 'video' then public.is_canonical_post_media_object_key(media_storage_path, actor_id, target_post_id, true)
    when media_kind = 'video_link' then media_storage_path is null and media_url is not null
    else false
  end;
$$;

drop policy if exists "post_media_insert_self" on public.post_media;
create policy "post_media_insert_self"
on public.post_media
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and p.author_id = auth.uid()
  )
  and public.can_bind_post_media_provenance(
    post_media.kind,
    post_media.storage_path,
    post_media.url,
    auth.uid(),
    post_media.post_id
  )
);

drop policy if exists "post_media_update_self_or_staff" on public.post_media;
create policy "post_media_update_self_or_staff"
on public.post_media
for update
to authenticated
using (user_id = auth.uid() or (select public.is_moderator_or_admin()))
with check (
  (select public.is_moderator_or_admin())
  or (
    user_id = auth.uid()
    and exists (
      select 1
      from public.posts p
      where p.id = post_media.post_id
        and p.author_id = auth.uid()
    )
    and public.can_bind_post_media_provenance(
      post_media.kind,
      post_media.storage_path,
      post_media.url,
      auth.uid(),
      post_media.post_id
    )
  )
);
