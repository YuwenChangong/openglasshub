# P10 forward-only production reconciliation preparation

## Scope and source binding

- Source start: `62ffa6daeef7034668dfd02166158f6d9e145354`.
- Historical migrations are not edited. The reconciliation is one new, uniquely-versioned migration: `supabase/migrations/20260902042807_forward_reconcile_devices.sql`.
- The execution wrapper refuses to start unless the clean checked-out `HEAD` exactly equals the operator-supplied `P10_APPROVED_SOURCE_COMMIT`.
- The wrapper accepts only the P9-validated project target and direct or session-pooler endpoint shape through the existing value-blind target validator. It takes the production DSN only from `P10_PRODUCTION_DATABASE_URL` in the operator process; it is never placed in argv or output.

## Reconciliation delta

P9 Packet 1 proved that `public.devices` was absent. This migration restores only that missing public contract:

1. `public.devices` table, canonical columns, defaults, and checks.
2. `devices_publication_status_idx`.
3. `devices_brand_key_idx`.
4. `devices_category_idx`.
5. Row-level security plus table grants.
6. `devices_select_published_public` policy.
7. `devices_select_staff_all` policy.
8. `devices_insert_staff` policy.
9. `devices_update_staff` policy.
10. `devices_delete_staff` policy.
11. `public.enforce_device_slug_lock()`.
12. `trg_devices_set_updated_at`.
13. `trg_devices_enforce_slug_lock`.

The migration has no table drop, truncate, data delete, data update, or destructive rewrite. Policy and trigger replacement is scoped to this previously absent table and is safe for replay. Its frozen SHA-256 is `2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65`.

## Local acceptance

All evidence is local and used no Production connection, SQL, mutation, deployment, or secret value.

- Production-shaped absent-device baseline: PASS.
- Already-canonical replay: PASS.
- Failure rollback probe: PASS.
- Fresh canonical repository migration mirror: PASS (36 migrations including this forward migration).
- P9 read-only regression and Packet 2 regression: PASS.
- Local cleanup: PASS.

## Authorized execution boundary

The prepared execution command is `node scripts/qa/p10-production-reconciliation.mjs`. It performs one `psql` process only after source, worktree, SQL hash, and target validation. The transcript begins a transaction, runs the frozen migration, checks `public.devices` and the slug-lock trigger, then commits. A failing psql process closes the open transaction without retry; counters report zero DML and zero production deployments. Production execution remains unperformed and requires separate authorization.
