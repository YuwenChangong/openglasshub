-- Enable realtime broadcasts for forum notification and social interaction tables.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'forum_notifications'
    ) then
      alter publication supabase_realtime add table public.forum_notifications;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'comments'
    ) then
      alter publication supabase_realtime add table public.comments;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'post_votes'
    ) then
      alter publication supabase_realtime add table public.post_votes;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'comment_reactions'
    ) then
      alter publication supabase_realtime add table public.comment_reactions;
    end if;
  end if;
end $$;
