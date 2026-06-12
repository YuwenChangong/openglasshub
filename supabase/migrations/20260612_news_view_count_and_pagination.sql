-- News view count RPC for public published article detail pages.

create or replace function public.increment_news_article_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.news_articles
  set view_count = coalesce(view_count, 0) + 1
  where slug = p_slug
    and status = 'published';
end;
$$;

grant execute on function public.increment_news_article_view(text) to anon, authenticated;
