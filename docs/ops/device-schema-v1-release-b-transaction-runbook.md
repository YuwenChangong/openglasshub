# Release B bounded Production transaction runbook

This runbook describes the authorization-bound Release B transaction contract for the reviewed future Production PostgreSQL adapter path. It is not an execution authorization, and it does not grant a Production connection.

The reviewed runner is [scripts/qa/release-b-production-runner.mjs](../../scripts/qa/release-b-production-runner.mjs). It is a thin composition root around the reviewed Production transport, the reviewed Production PostgreSQL adapter in [scripts/qa/lib/release-b-production-postgres-adapter.mjs](../../scripts/qa/lib/release-b-production-postgres-adapter.mjs), and the existing executor in [scripts/qa/release-b-production-import.mjs](../../scripts/qa/release-b-production-import.mjs). Do not use an alternate SQL client, manual SQL, migration command, provider console, deployment command, or `qa:prod` for Release B.

## Operator commands

Preflight, non-mutating:

```powershell
node .\scripts\qa\release-b-production-runner.mjs --preflight-production-transport
```

Future execution, only after a fresh v4 authorization receipt is reviewed:

```powershell
node .\scripts\qa\release-b-production-runner.mjs --execute-production --authorization-receipt <reviewed-v4-receipt.json> --authorization-receipt-sha256 <reviewed-v4-receipt-sha256>
```

The runner reads `P9_PRODUCTION_DATABASE_URL` only from the operator process environment. There is no DSN command-line argument, repository file, dotenv loader, provider console path, or fallback source. The value must be the Production Session Pooler shape accepted by the existing P9 contract; the adapter-bound path rejects the direct endpoint and Transaction Pooler. The runner, adapter, transport, executor, receipts, and evidence must never print, log, store, hash for output, or serialize the DSN or any host/user/password fragments. Clear the transient process credential after the operation attempt completes or blocks.

Importing the runner and adapter has no side effects. Preflight validates only value-blind structure and wiring metadata; it does not connect, run SQL, start a transaction, consume an approval, create or mutate a ledger entry, or write Production.

## Current authorization binding

The current adapter-bound execution schema is `openglass-device-schema-v1-release-b-authorization-v4`. Historical v1/v2/v3 receipts remain validateable where tests require them, but they cannot execute the adapter-bound runner path. `release-b-approval-2` and `release-b-approval-3` are historical and cannot authorize this runner.

The v4 receipt is canonical recursive-key-sorted JSON with a trailing newline for receipt hashing. Arrays retain order, UTF-8 is required, unknown fields are rejected, and no secret material is permitted. It must bind at least:

- Approval ID and strict UTC authorization time for a new human authorization.
- Target `OpenGlass Hub Supabase Production`, project ref `xcbnxzjlsvtgzixurcof`.
- Task 17 final commit, frozen gate source commit, normalized payload SHA-256, dry-run fingerprint, identity map, source metadata, conflict map, and importer code fingerprints.
- Task 18 transport commit, current executor commit, runner commit, runner path, Production transport fingerprint, Production executor fingerprint, and Production runner fingerprint.
- Production PostgreSQL adapter path `scripts/qa/lib/release-b-production-postgres-adapter.mjs`, adapter commit, and Production PostgreSQL adapter fingerprint.
- Exact before and after counts, the sole operation `RELEASE_B_PRODUCTION_IMPORT`, `maxAttempts: 1`, and `automaticRetry: false`.
- `false` for deletes, schema/history mutation, Cloudflare writes, deployment, push, merge, and `qa:prod`.

Do not fabricate a v4 approval. An unauthorized candidate may list required fields and fingerprints, but it must not assert `approvalId` or `authorizedAtUtc` unless a reviewed schema explicitly supports an unauthorized candidate state.

The old `scripts/qa/generate-release-b-authorization-receipt.mjs` path is historical v2 validation only and is not an operator path for this runner. It must not be used to create or reuse `release-b-approval-2` for execution.

## Execution contract

Execution requires the exact explicit flag `--execute-production`, a valid v4 receipt, an exact adapter fingerprint binding, an unconsumed durable ledger entry, exact target identity, exact precheck, and the reviewed adapter/transport/executor chain. The executor rebuilds the Release B plan from committed inputs immediately before target verification and transaction work. A caller-supplied plan is diagnostic-only and cannot select rows for execution.

The durable ledger is `artifacts/device-schema-v1/release-b-production-ledger`. The executor atomically creates and syncs one `STARTED` entry before transaction work. Existing entries reject with `RELEASE_B_APPROVAL_ALREADY_CONSUMED`; the entry is never removed by the executor, including after deterministic failure or ambiguity.

After `BEGIN`, `readPrecheckForUpdate()` must lock and read Release A history, schema postconditions, whether Release B is already applied, and the seven exact before counts. Any mismatch is `RELEASE_B_PRODUCTION_PRECONDITION_DRIFT`; reconciliation is forbidden.

The coordinator permits only `definition`, `device`, `source`, `sourceLink`, `spec`, `evidence`, and YAML-derived `compatibility` entities. It has no delete, truncate, DDL, migration-history, configuration, Cloudflare, deploy, push, merge, or retry operation.

A timeout, transport loss, provider-unknown outcome, uncertain commit acknowledgement, or post-commit verification transport loss is `RELEASE_B_EXECUTION_AMBIGUOUS`. It consumes the authorization and must not retry. Deterministic failures also do not authorize retry. Ambiguity means stop, preserve evidence, clear transient credentials, and request a new reviewed decision; do not rerun, reset the ledger, switch clients, or reconcile manually.

After commit, read-only verification must match all seven exact after counts, 24 unique slugs, the frozen published count, conflict invariants, Ray-Ban identity `ray-ban-meta`, and zero unexpected deletes. A deterministic verification failure is `RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED`.

Only these application tables are in write scope: `public.devices`, `public.device_spec_definitions`, `public.device_specs`, `public.device_sources`, `public.device_source_links`, `public.device_spec_evidence`, and `public.catalog_audit_events`. The current frozen plan has no audit-event rows; its expected audit count remains zero.

## Offline proof

`node scripts/qa/test-release-b-production-runner.mjs` covers the reviewed runner composition root, value-blind credential handling, Session Pooler validation, v1/v2/v3 execution rejection, v4 runner and adapter fingerprint binding, retry flags, unknown-field rejection, and no alternate SQL surface.

`node scripts/qa/test-release-b-authorization-receipt-v2.mjs` preserves historical v1/v2 validation and proves they cannot execute the current runner-bound Production path.

`node scripts/qa/test-release-b-authorization-receipt-v4.mjs` covers v4 schema strictness and adapter fingerprint binding.

`node scripts/qa/test-release-b-production-postgres-adapter.mjs`, `node scripts/qa/test-release-b-production-postgres-adapter-local.mjs`, and `node scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs` cover the adapter contract, disposable PostgreSQL behavior, full disposable Release B rehearsal, Session Pooler-only execution, TLS fail-closed behavior, no retry, and no Production access.

`node scripts/qa/test-device-schema-v1-transaction-contract.mjs` and `node scripts/qa/test-release-b-production-transport.mjs` cover immutable-plan binding, transaction ordering, no-delete/no-DDL/no-migration-history gates, ambiguity classification, no retry, durable consumption, and transport safety without Production access.
