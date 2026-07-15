# W6 Server-Only Atomic Rate-Limit Architecture

Status: `APPROVED_ARCHITECTURE_NOT_IMPLEMENTED`. This is a security/product decision record, not executable production SQL and not approval to alter a database.

## Decision

The replacement for the direct `forum_upload_attempts` read-then-insert path will be a server-only, atomic, fail-closed rate-limit operation. It will not grant table privileges to `PUBLIC`, `anon`, or `authenticated`, and it will not remove either legacy extra policy until the runtime callers have migrated and the deployment has been independently verified.

## Required Contract

- A trusted server-only caller provides only server-derived actor, purpose, IP hash, byte count, limit, and window inputs.
- The operation checks the applicable window and records the accepted attempt as one concurrency-safe database operation.
- It returns a fixed structured result: allowed versus rate-limited, without leaking attempt rows or other users' metadata.
- Database, RPC, validation, or unexpected-result failure denies the action. It must never retain the existing fail-open backend-unavailable behavior.
- The eventual function has a fixed owner, explicitly safe `search_path`, minimal execute ACL, no PUBLIC/anon/authenticated execute path, and no dynamic SQL or caller-selectable object identity.

## Current Evidence and Hold

`src/lib/server/rate-limit.ts` currently uses a caller-bound Supabase client to count and then insert `public.forum_upload_attempts`. The authenticated privilege packets prove that `authenticated` lacks effective table `SELECT` and `INSERT`; the direct route is therefore not authorized. The table has RLS enabled and not forced. RLS policies do not grant table privileges.

The canonical SELECT policy uses `USING true`, so granting broad authenticated SELECT merely to restore the legacy path is unsafe. INSERT-only is insufficient and leaves the count/insert race unresolved. The two extra policies can be RLS-redundant while still being unsafe to remove before a migrated and verified server-only replacement exists.

## Implementation Readiness Checklist

1. Refresh the current production catalog packet and resolve the prior index-evidence conflict before any new proposal is reviewed.
2. Trace each caller of `enforceUserRateLimit` and `enforceUploadRateLimit`, including caller identity, purpose, window, quota, error behavior, and first irreversible effect.
3. Specify the RPC signature, enum/allowlist validation, structured response, owner, `search_path`, ACL matrix, RLS interaction, and error contract from source-backed requirements.
4. Author a forward migration and runtime migration plan only after the above contract has reviewable source evidence. The current decision does not authorize either artifact.
5. Add deterministic concurrency, malformed-input, unauthorized-role, backend-failure, no-row-exposure, and rollback tests.
6. Deploy the function and migrated runtime callers under a separate approval. Verify no direct client table access remains before separately reviewing removal of either legacy policy.

No index, policy, grant, function, runtime, migration, or production change is authorized by this record.
