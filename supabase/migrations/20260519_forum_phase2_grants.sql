-- Forum Phase 2: grant baseline table privileges for anon/authenticated.
-- RLS still controls row-level access; these grants only allow SQL to reach policy checks.

grant usage on schema public to anon, authenticated;

grant select on table public.profiles to anon, authenticated;
grant select on table public.circles to anon, authenticated;
grant select on table public.posts to anon, authenticated;
grant select on table public.comments to anon, authenticated;
grant select on table public.post_votes to anon, authenticated;

grant insert, update, delete on table public.profiles to authenticated;
grant insert, update, delete on table public.posts to authenticated;
grant insert, update, delete on table public.comments to authenticated;
grant insert, update, delete on table public.reports to authenticated;
grant insert on table public.moderation_actions to authenticated;
grant select on table public.moderation_actions to authenticated;
grant insert, update, delete on table public.post_votes to authenticated;
grant insert, update, delete on table public.bookmarks to authenticated;
grant select on table public.bookmarks to authenticated;

-- staff-managed table writes (RLS still enforced by role checks)
grant insert, update, delete on table public.circles to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
