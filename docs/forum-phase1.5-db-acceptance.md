# Forum Phase 1.5 Database Acceptance

Date: 2026-05-19  
Project: `xcbnxzjlsvtgzixurcof` (`openglasshub-forum`)

## Scope

This acceptance confirms that Forum Phase 1 schema was applied to Supabase remote database and baseline seed data exists.

## Acceptance checklist

1. Migration applied to remote database with Supabase CLI `db push`  
Result: Passed

2. Public tables exist  
Expected:
- `profiles`
- `circles`
- `posts`
- `comments`
- `reports`
- `moderation_actions`
- `post_votes`
- `bookmarks`  
Result: Passed

3. RLS enabled on all forum tables  
Expected: `rowsecurity = true` for the 8 forum tables  
Result: Passed

4. Required enum types exist  
Expected:
- `user_role`
- `circle_type`
- `post_type`
- `post_status`
- `comment_status`
- `report_status`
- `report_target_type`
- `moderation_target_type`  
Result: Passed

5. Initial circles seeded  
Expected slugs:
- `xreal`
- `rokid`
- `rayneo`
- `meta-ai-glasses`
- `brilliant-labs`
- `gaze-os`  
Result: Passed

## Executed SQL for acceptance

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

```sql
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

```sql
select n.nspname as schema_name, t.typname as enum_name, e.enumlabel as enum_value
from pg_type t
join pg_enum e on t.oid = e.enumtypid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname in (
    'user_role',
    'circle_type',
    'post_type',
    'post_status',
    'comment_status',
    'report_status',
    'report_target_type',
    'moderation_target_type'
  )
order by enum_name, e.enumsortorder;
```

```sql
select slug, name, type
from public.circles
order by slug;
```

## Evidence

- Supabase SQL Editor run for seed insert: success
- Supabase SQL Editor query for circles: returns 6 expected rows
- Local migration and seed files:
  - [20260518_forum_phase1_schema.sql](D:/OpenGlass%20Hub/supabase/migrations/20260518_forum_phase1_schema.sql)
  - [seed_circles.sql](D:/OpenGlass%20Hub/supabase/seed_circles.sql)

## Ready for next phase

Forum Phase 1.5 is complete.  
Proceed to Forum Phase 2: RLS audit and permission tests before Auth integration.
