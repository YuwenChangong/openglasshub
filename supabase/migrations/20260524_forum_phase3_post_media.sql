-- Forum Phase 3: post media table + storage bucket for image uploads.
-- Keeps public browsing on anon key + RLS. No service role required in frontend/API.

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('image', 'video_link')),
  url text,
  storage_path text,
  thumbnail_url text,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0 and sort_order <= 99),
  created_at timestamptz not null default now(),
  check (
    (kind = 'image' and storage_path is not null and url is null)
    or (kind = 'video_link' and url is not null)
  )
);

create index if not exists post_media_post_sort_idx
  on public.post_media(post_id, sort_order asc, created_at asc);

create index if not exists post_media_user_idx
  on public.post_media(user_id, created_at desc);

alter table public.post_media enable row level security;

drop policy if exists "post_media_select_public_or_owner" on public.post_media;
create policy "post_media_select_public_or_owner"
on public.post_media
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and (
        p.status = 'published'
        or p.author_id = auth.uid()
        or (select public.is_moderator_or_admin())
      )
  )
);

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
);

drop policy if exists "post_media_update_self_or_staff" on public.post_media;
create policy "post_media_update_self_or_staff"
on public.post_media
for update
to authenticated
using (user_id = auth.uid() or (select public.is_moderator_or_admin()))
with check (user_id = auth.uid() or (select public.is_moderator_or_admin()));

drop policy if exists "post_media_delete_self_or_staff" on public.post_media;
create policy "post_media_delete_self_or_staff"
on public.post_media
for delete
to authenticated
using (user_id = auth.uid() or (select public.is_moderator_or_admin()));

grant select on table public.post_media to anon, authenticated;
grant insert, update, delete on table public.post_media to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post_media_objects_select_public_or_owner" on storage.objects;
create policy "post_media_objects_select_public_or_owner"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (
    owner = auth.uid()
    or (select public.is_moderator_or_admin())
    or exists (
      select 1
      from public.post_media pm
      join public.posts p on p.id = pm.post_id
      where pm.storage_path = storage.objects.name
        and (
          p.status = 'published'
          or pm.user_id = auth.uid()
          or (select public.is_moderator_or_admin())
        )
    )
  )
);

drop policy if exists "post_media_objects_insert_self" on storage.objects;
create policy "post_media_objects_insert_self"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and owner = auth.uid()
  and name like auth.uid()::text || '/%'
);

drop policy if exists "post_media_objects_update_self_or_staff" on storage.objects;
create policy "post_media_objects_update_self_or_staff"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (owner = auth.uid() or (select public.is_moderator_or_admin()))
)
with check (
  bucket_id = 'post-media'
  and (owner = auth.uid() or (select public.is_moderator_or_admin()))
);

drop policy if exists "post_media_objects_delete_self_or_staff" on storage.objects;
create policy "post_media_objects_delete_self_or_staff"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (owner = auth.uid() or (select public.is_moderator_or_admin()))
);
