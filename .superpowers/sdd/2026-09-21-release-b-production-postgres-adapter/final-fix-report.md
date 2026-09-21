# Final Fix Report: Release B Runner Collaborator Injection

## Status

Implemented final-review Critical fix for the Release B Production runner boundary.

## RED Evidence

- Command: `node scripts/qa/test-release-b-production-runner.mjs`
- Result before production fix: exit 1.
- Expected regression failure observed: `AssertionError [ERR_ASSERTION]: adapter-bound runner rejects manual transport collaborator injection even with a valid v4 receipt`.
- Actual old-path evidence: `executeProductionImport` was reached and threw `manual transport collaborators must be rejected before executor handoff`, proving paired `createSession` / `readPostcheck` injection bypassed the adapter-bound runner path.

## GREEN Evidence

- `node scripts/qa/test-release-b-production-runner.mjs`
  - `RELEASE_B_PRODUCTION_RUNNER_CONTRACT_OK`
- `node scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`
  - `RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_REHEARSAL_OK`
  - `runnerAdapterTransportExecutor: PASS`
  - `retryRejected: PASS`
  - `rollbackAtomicity: PASS`
  - `localDisposablePostgres: PASS`
  - `productionConnections: 0`
  - `localTestFlag: ABSENT`
- `node scripts/qa/test-release-b-production-transport.mjs`
  - `RELEASE_B_PRODUCTION_TRANSPORT_UNIT_OK`
- `node scripts/qa/test-release-b-authorization-receipt-v4.mjs`
  - `RELEASE_B_AUTHORIZATION_RECEIPT_V4_CONTRACT_OK`
- `git diff --check`
  - Exit 0.
  - PowerShell/Git emitted line-ending warnings for the two touched runner files only.

## Files Changed

- `scripts/qa/release-b-production-runner.mjs`
- `scripts/qa/test-release-b-production-runner.mjs`
- `.superpowers/sdd/2026-09-21-release-b-production-postgres-adapter/final-fix-report.md`

## Fix Summary

- Added a regression test proving `runReleaseBProductionRunner()` rejects manual `createSession` / `readPostcheck` injection with a valid V4 receipt before the supplied session/postcheck/executor path can run.
- Changed `runReleaseBProductionRunner()` to throw `RELEASE_B_RUNNER_TRANSPORT_COLLABORATOR_INJECTION_FORBIDDEN` when either manual transport collaborator is supplied.
- Preserved the lower-level `createReleaseBProductionRunnerTransport()` helper for tests.
- Preserved the adapter `PostgresClient` seam for local no-socket tests.
- Runner transport collaborators now always come from `createReleaseBProductionPostgresAdapter({ environment, Client: PostgresClient })`.

## Commit

- Commit SHA: recorded in the final response after commit creation.
- Commit message: `fix: forbid Release B runner collaborator injection`

## Concerns

- No Production, `qa:prod`, deploy, merge, Cloudflare mutation, Supabase Production SQL, manual Production SQL, or Production probe was run.
- The committed report cannot self-embed its containing commit SHA without changing that SHA; the final response records the actual post-commit SHA.
