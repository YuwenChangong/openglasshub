alter table public.posts
drop constraint if exists posts_body_check;

alter table public.posts
add constraint posts_body_check
check (
  char_length(trim(coalesce(body, ''))) >= 1
  and char_length(body) <= 50000
);

notify pgrst, 'reload schema';
