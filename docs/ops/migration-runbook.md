# Migration Runbook

## Core rules

- Production migration must be preflighted before execution.
- Production migration SQL must not be rerun casually.
- Reports optimization migration is already applied.
- Orphan report rows must not be deleted casually just to satisfy a migration.
- Migration execution must be manual and explicit.
- Do not run production migration from preview QA.

## Preflight examples

Read-only SQL examples:

```sql
select id, target_type, target_id, status, created_at
from public.reports
order by created_at desc
limit 20;
```

```sql
select id, target_type, target_id, status, created_at
from public.reports
where
  (target_type = 'post' and not exists (select 1 from public.posts p where p.id = reports.target_id))
  or (target_type = 'comment' and not exists (select 1 from public.comments c where c.id = reports.target_id))
  or (target_type = 'circle' and not exists (select 1 from public.circles circle_row where circle_row.id = reports.target_id))
  or (target_type = 'user' and not exists (select 1 from public.profiles profile_row where profile_row.id = reports.target_id))
order by created_at desc;
```

```sql
select column_name
from information_schema.columns
where table_name = 'reports'
order by column_name;
```

## Reports optimization status

- `supabase/migrations/20260627_reports_optimization_mvp.sql` is already applied in production.
- Do not rerun it unless a reviewed manual recovery plan explicitly requires it.

## Rollback decision criteria

- If the issue is code-only, prefer rolling back the Cloudflare Pages deployment first.
- If the issue is schema-related, stop and review impact before attempting any SQL rollback.
- Never improvise a destructive down migration against production data.
