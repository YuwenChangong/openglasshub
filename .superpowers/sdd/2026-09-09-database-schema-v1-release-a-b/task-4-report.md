# Task 4 report: RLS, grants, and immutable audit

## Scope delivered

- Added `public.is_catalog_admin()` backed by the existing protected
  `public.current_user_role()` role source.
- Replaced only `devices` catalog CRUD policies with catalog-admin authority;
  published-device public reads and the existing moderator/admin read policy
  remain unchanged.
- Added admin-only normalized catalog policies and revoked anonymous direct
  access to all normalized base tables.
- Made the audit foundation database-append-only: catalog admins may insert and
  read; anonymous callers cannot access it; update/delete privileges and RLS
  policies are absent, with the existing mutation-prevention trigger retained.
- Changed the existing catalog device API route to `requireAdmin`, aligned with
  the database policies. No catalog audit UI/API writer was added.
- Added a real disposable-PostgreSQL RLS/grant test and updated the existing
  disposable enforcement bootstrap with the role/helper prerequisites now
  required by the Task 2 migration.

## RED evidence

Command:

```powershell
node scripts/test-device-schema-v1-rls.mjs
```

Before the migration policy changes it failed with **2 policy mismatches**:

1. A moderator could delete a catalog device through the legacy staff CRUD
   policy.
2. An admin could not append/read the audit foundation because its grants and
   policies did not yet exist.

Server-alignment RED command:

```powershell
node scripts/test-device-admin-api.mjs
```

Before changing the route authorization it failed the new moderator-only
catalog mutation assertion (the route still used `requireModerator`).

## GREEN evidence

Fresh verification command:

```powershell
node scripts/test-device-schema-v1-rls.mjs; node scripts/test-device-persistence.mjs; node scripts/test-device-admin-api.mjs; node scripts/test-device-schema-v1-enforcement.mjs; git diff --check
```

Result: exit code **0**.

- `DEVICE_SCHEMA_V1_RLS_OK cases=10 postgres=local-disposable`
- `DEVICE_PERSISTENCE_FOUNDATION_AUDIT_OK`
- `DEVICE_ADMIN_API_AUDIT_OK`
- `DEVICE_SCHEMA_V1_ENFORCEMENT_OK cases=89 postgres=local-disposable`
- `git diff --check` reported no whitespace errors.

## Concerns

None. The only audit behavior added is its database policy/grant foundation;
no Release C audit UI/API writer was introduced.

## Commit

`e4bcaa85 feat(devices): restrict Schema v1 catalog authority`
