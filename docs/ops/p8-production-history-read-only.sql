-- P8 authorization packet. Do not run until explicit production-read authorization is granted.
-- This file is intentionally read-only: it contains only metadata SELECT statements.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
ORDER BY ordinal_position;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('devices', 'profiles', 'circles', 'posts', 'forum_notifications', 'news_articles')
ORDER BY table_name;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('devices', 'profiles', 'circles', 'posts', 'forum_notifications', 'news_articles')
ORDER BY tablename, policyname;

SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_staff', 'can_manage_post', 'notify_post_like', 'increment_news_view_count')
ORDER BY p.proname;
