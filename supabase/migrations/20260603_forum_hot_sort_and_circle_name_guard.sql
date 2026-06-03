alter table public.posts
  add column if not exists view_count integer not null default 0;

create index if not exists posts_view_count_idx
  on public.posts(view_count desc);

create unique index if not exists circles_name_lower_unique_idx
  on public.circles (lower(name));

create or replace function public.increment_post_view_count(target_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts
  set view_count = coalesce(view_count, 0) + 1
  where id = target_post_id
    and status = 'published';
$$;

grant execute on function public.increment_post_view_count(uuid) to anon, authenticated;
