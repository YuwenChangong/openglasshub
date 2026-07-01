# Rollback Runbook

## When to rollback Cloudflare Pages production deployment

- Roll back when the latest production deploy introduces public `500`s, broken auth flows, broken admin access, or widespread moderation/runtime failure.
- Prefer a Pages rollback when the failure is code/config related and not caused by a new database migration.

## What not to rollback blindly

- Do not blindly roll back database migrations.
- Do not roll back by weakening RLS, moderation privacy, or secret handling.
- Do not assume preview safety means production safety.

## DB migration warning

- Database rollback needs a reviewed manual plan.
- Reports optimization migration is already applied and must not be casually rerun or blindly reverted.

## Verify rollback health

- Confirm the target deployment is the last known good production deployment.
- Re-run public smoke checks after rollback.
- Confirm admin unauth checks still block correctly.
- Confirm moderation lexicon health still reports R2-backed runtime behavior.

## Post-rollback smoke checklist

- `GET /` -> `200`
- `GET /feed/` -> `200`
- `GET /circles/` -> `200`
- `GET /api/forum/reports` -> `405`
- `GET /api/admin/reports` without bearer -> `401`
- `GET /api/admin/moderation/lexicon-health` without bearer -> `401`
