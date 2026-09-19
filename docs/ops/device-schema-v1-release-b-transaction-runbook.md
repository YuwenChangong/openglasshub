# Release B bounded Production transaction runbook

This runbook describes the authorization-bound Release B transaction contract. It is not an execution authorization and it does not provide a connection command, credential location, migration command, or retry procedure.

The executor is [scripts/qa/release-b-production-import.mjs](../../scripts/qa/release-b-production-import.mjs). Its only executable flag is exactly `--execute-production`. It has no default write mode, no environment-derived target, no provider adapter, and no CLI path to construct a transport. A future reviewed transport must call its programmatic boundary after a separate authorization receipt has been reviewed.

## Immutable authorization binding

The receipt schema is `openglass-device-schema-v1-release-b-authorization-v1`. It is canonical JSON with a trailing newline, SHA-256 content-addressed, and its supplied SHA-256 must equal the exact canonical receipt bytes. The receipt must bind all of the following:

- Approval ID matching `^release-b-approval-[0-9]+$` and a syntactically valid `YYYY-MM-DDTHH:MM:SSZ` authorization time.
- Target `OpenGlass Hub Supabase Production`, project ref `xcbnxzjlsvtgzixurcof`.
- Task 17 final commit `ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a`, plus the frozen gate candidate source commit `4787375a84cb55b3fb3fc86bdab66ae6dc565fbc`.
- The committed gate's normalized-payload, recovery-plan, identity-map, source-metadata, conflict-map, and importer-code fingerprints.
- Exact before and after counts, the sole operation `RELEASE_B_PRODUCTION_IMPORT`, and `maxAttempts: 1`.
- `false` for deletes, schema/history mutation, Cloudflare writes, deployment, push, merge, and `qa:prod`.

Authorization freshness is intentionally not inferred: `AUTHORIZATION_EXPIRY_POLICY=NOT_DEFINED`.

## Future execution sequence

1. Supply exactly one `--execute-production` argument, the reviewed content-addressed receipt, its SHA-256, and a reviewed transport. The production entry point always uses `artifacts/device-schema-v1/release-b-production-ledger`; a caller-supplied directory cannot change this identity. A supplied plan is diagnostic-only; the executor always rebuilds the plan it executes.
2. Immediately before target verification and the transaction, the executor rebuilds the Release B plan from the committed YAML/model/planner inputs and verifies its normalized-payload and dry-run fingerprints plus operation counts. It rejects all mismatched receipt fields, target identity, payload fingerprint, dry-run fingerprint, operations, delete indicators, blocked/conflicted plan entries, and out-of-scope entities before a transaction starts.
3. Before the transaction, the executor atomically creates and syncs one `STARTED` consumption entry named from the approved ID in the canonical ledger. Existing entries reject with `RELEASE_B_APPROVAL_ALREADY_CONSUMED`. The entry is never removed by the executor, including after an error or uncertain outcome.
4. After `BEGIN` and before any write, `readPrecheckForUpdate()` must lock and read Release A history, schema postconditions, whether Release B is already applied, and the seven exact frozen before counts. Any mismatch is `RELEASE_B_PRODUCTION_PRECONDITION_DRIFT`; reconciliation is forbidden. The disposable adapter uses one persistent PostgreSQL session and `SHARE ROW EXCLUSIVE` relation locks, which also protect empty tables from concurrent inserts.
5. The transaction coordinator permits only `definition`, `device`, `source`, `sourceLink`, `spec`, `evidence`, and YAML-derived `compatibility` plan entities, in deterministic dependency order. It has no delete, truncate, DDL, migration, history, configuration, Cloudflare, deploy, push, merge, or retry operation.
6. All writes run through the same atomic transaction as the locked precheck. A failed transaction must roll back; a timeout, transport loss, or uncertain acknowledgement leaves the authorization consumed. The executor classifies native `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, and PostgreSQL `57P01`, including post-commit read failure, as `RELEASE_B_EXECUTION_AMBIGUOUS`. It must not retry.
7. After commit, read-only verification must match all seven exact after counts, 24 unique slugs, the frozen published count, conflict invariants, Ray-Ban identity `ray-ban-meta`, and zero unexpected deletes. A failure is `RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED`; it is not a retry authorization.

Only the seven allowed application tables are in write scope: `public.devices`, `public.device_spec_definitions`, `public.device_specs`, `public.device_sources`, `public.device_source_links`, `public.device_spec_evidence`, and `public.catalog_audit_events`. The current frozen plan has no audit-event rows; its expected audit count remains the gate's exact value.

## Offline proof

`node scripts/qa/test-device-schema-v1-transaction-contract.mjs` tests authorization, immutable-plan binding, outcome classification, transaction-session ordering, and double-consumption rejection without database access. It injects a temporary consumption store. A preexisting canonical `STARTED` sentinel is represented in an isolated filesystem namespace; after proving the default entry point rejects that sentinel, filesystem tripwires forbid canonical access throughout the injected suite and cleanup. The actual durable production ledger is never read or modified.

`node scripts/qa/test-release-b-production-disposable-rehearsal.mjs` creates its own local disposable Supabase project and replays the canonical 50-migration chain. It exercises the executor and shared coordinator against PostgreSQL, proves drift introduced after `BEGIN` blocks every write, proves a competing writer is blocked by the relation lock, injects a real CHECK failure at evidence writes and verifies zero committed rows, then commits the valid frozen plan once and verifies exact counts. All receipts are synthetic and stored only in the owned temporary directory. The disposable transport simulates the production identity solely to exercise the authorization boundary; it contains no production connection path.
