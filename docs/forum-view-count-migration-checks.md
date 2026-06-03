# Forum view count migration checks

Run these SQL checks in Supabase when preview or production starts failing around post detail or hot sorting:

```sql
select column_name
from information_schema.columns
where table_name = 'posts'
  and column_name = 'view_count';

select proname
from pg_proc
where proname = 'increment_post_view_count';

select indexname
from pg_indexes
where tablename = 'circles'
  and indexdef ilike '%lower%name%';
```

Expected:

- `posts.view_count` exists
- `increment_post_view_count` exists
- a `circles` unique index on `lower(name)` exists
