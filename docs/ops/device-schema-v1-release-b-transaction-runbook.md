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

1. Supply exactly one `--execute-production` argument, the reviewed content-addressed receipt, its SHA-256, an explicit ignored local ledger directory, a reviewed transport, and a rebuilt Release B plan.
2. Immediately before target verification and the transaction, the executor rebuilds the Release B plan from the committed YAML/model/planner inputs and verifies its normalized-payload and dry-run fingerprints plus operation counts. It rejects all mismatched receipt fields, target identity, payload fingerprint, dry-run fingerprint, operations, delete indicators, blocked/conflicted plan entries, and out-of-scope entities before a transaction starts.
3. The transport must read-only verify Release A history and schema postconditions, verify Release B is not already applied, and compare the seven exact frozen before counts. Any mismatch is `RELEASE_B_PRODUCTION_PRECONDITION_DRIFT`; reconciliation is forbidden.
4. Before the transaction, the executor atomically creates one `STARTED` consumption entry named from the approved ID in the explicitly supplied ledger. Existing entries reject with `RELEASE_B_APPROVAL_ALREADY_CONSUMED`. The entry is never removed by the executor, including after an error or uncertain outcome.
5. The transaction coordinator permits only `definition`, `device`, `source`, `sourceLink`, `spec`, `evidence`, and YAML-derived `compatibility` plan entities, in deterministic dependency order. It has no delete, truncate, DDL, migration, history, configuration, Cloudflare, deploy, push, merge, or retry operation.
6. The transport executes one atomic transaction. A failed transaction must roll back; a timeout, transport loss, or uncertain acknowledgement leaves the authorization consumed and is handled as `RELEASE_B_EXECUTION_AMBIGUOUS` by the future transport boundary. It must not retry.
7. After commit, read-only verification must match all seven exact after counts, 24 unique slugs, the frozen published count, conflict invariants, Ray-Ban identity `ray-ban-meta`, and zero unexpected deletes. A failure is `RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED`; it is not a retry authorization.

Only the seven allowed application tables are in write scope: `public.devices`, `public.device_spec_definitions`, `public.device_specs`, `public.device_sources`, `public.device_source_links`, `public.device_spec_evidence`, and `public.catalog_audit_events`. The current frozen plan has no audit-event rows; its expected audit count remains the gate's exact value.

## Offline proof

`node scripts/qa/test-device-schema-v1-transaction-contract.mjs` uses only a fake disposable transport. It proves valid one-transaction behavior, rollback on a late constraint failure, rejection before mutation for malformed authorization/preconditions/targets/plans, and ledger-backed double-consumption rejection. It makes no network or provider call.
