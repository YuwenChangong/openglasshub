-- Public post-media delivery requires the same visible post -> circle ancestry
-- as public post and comment reads, plus an exact canonical stored object key.

create or replace function public.can_access_public_post_media_object(target_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.post_media pm
    join public.posts p on p.id = pm.post_id
    where p.status = 'published'
      and p.moderation_status = 'published'
      and public.can_access_public_circle(p.circle_id)
      and (
        (
          pm.storage_path = target_object_name
          and (
            (pm.kind = 'image' and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, false))
            or (pm.kind = 'video' and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, true))
          )
        )
        or (
          pm.thumbnail_url = target_object_name
          and public.is_canonical_post_media_object_key(target_object_name, pm.user_id, pm.post_id, false)
        )
      )
  );
$$;

revoke all on function public.can_access_public_post_media_object(text) from public;
grant execute on function public.can_access_public_post_media_object(text) to anon, authenticated;

drop policy if exists "post_media_select_public_or_owner" on public.post_media;
create policy "post_media_select_public_or_owner"
on public.post_media
for select
to anon, authenticated
using (
  (
    exists (
      select 1
      from public.posts p
      where p.id = post_media.post_id
        and p.status = 'published'
        and p.moderation_status = 'published'
        and public.can_access_public_circle(p.circle_id)
    )
    and (
      (post_media.kind = 'image' and public.is_canonical_post_media_object_key(post_media.storage_path, post_media.user_id, post_media.post_id, false))
      or (post_media.kind = 'video' and public.is_canonical_post_media_object_key(post_media.storage_path, post_media.user_id, post_media.post_id, true))
    )
    and (
      post_media.thumbnail_url is null
      or public.is_canonical_post_media_object_key(post_media.thumbnail_url, post_media.user_id, post_media.post_id, false)
    )
  )
  or post_media.user_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "post_media_objects_select_public_or_owner" on storage.objects;
create policy "post_media_objects_select_public_or_owner"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (
    public.can_access_public_post_media_object(name)
    or owner = auth.uid()
    or (select public.is_moderator_or_admin())
  )
);
