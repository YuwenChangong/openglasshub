# R6 Production Rollout Packet

Status: `R6_SINGLE_RESULT_PACKET_READY` (repository-only). This packet
does not authorize a cloud connection, secret creation, SQL execution, merge,
or deployment. `R5_PREVIEW_BLOCKED_TARGET_IDENTITY` remains in force because
hosted Preview uses Production data; local R5L is evidence, not Preview
verification. `SUPABASE_SERVICE_ROLE_KEY` remains
`BINDING_ABSENT_PRODUCTION_BLOCKED`.

## Immutable inputs

| Input | Required value |
| --- | --- |
| Source branch commit | `1443c6a7faeb388f206b96cef9e9750fa82a65cc` or a separately approved descendant |
| R2 proposal | `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` |
| R2 SHA-256 | `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb` |
| Runtime lineage | `96812e99006e99599d23ec544bcce9e224dd328e` |
| Local evidence | `R5_LOCAL_STAGING_VERIFIED` |
| Binding | `SUPABASE_SERVICE_ROLE_KEY`, Production server-only, encrypted, no `PUBLIC_` prefix |

## Risk boundary

No distinct hosted Preview Supabase database exists. Any future Production
execution needs a new explicit approval:
`APPROVE_R6_PRODUCTION_STAGED_EXECUTION_WITH_LOCAL_STAGING_ONLY_RISK_ACCEPTANCE`.
The operator must accept that R5L, R3, and static review do not prove the
Production target, secret binding, deployment identity, or cloud runtime.

## Ordered checkpoints

`R6-0` approval and exact commit; `R6-1` target identity; `R6-2` database
preflight; `R6-3` encrypted binding creation; `R6-4` binding metadata
postflight and bundle/log audit; `R6-5` RPC execution; `R6-6` SQL postflight;
`R6-7` reviewed main merge/deployment commit; `R6-8` Production deployment;
`R6-9` deployment identity/client exposure audit; `R6-10` low-volume canary;
`R6-11` canary cleanup/residue; `R6-12` closure decision. A failed checkpoint
stops all later checkpoints.

Target identity must reconcile the dashboard project ref, Direct Connection
host/ref, SQL operator target, Pages project, Production branch/deployment,
runtime `SUPABASE_URL` ref, and expected deployment commit. Record only
redacted identifiers. Continue only on `PRODUCTION_TARGET_IDENTITY_CONFIRMED`;
otherwise classify `PRODUCTION_TARGET_IDENTITY_AMBIGUOUS`,
`PRODUCTION_TARGET_MISMATCH`, or `INSUFFICIENT_EVIDENCE`.

## Binding checkpoints

R6-B1 records Production-only metadata preflight. R6-B2 creates the encrypted
server-only secret only under explicit approval. R6-B3 proves metadata only;
it never logs, hashes, reads, or exports the value. R6-B4 verifies that browser
assets and logs expose neither the key nor service-role terminology. Preview is
unchanged. Runtime value correctness is proved only by the canary.

## SQL and runtime gates

The former R6-2 packet was connector-incompatible: the available connector
discarded every result set except the last, leaving relation, index, RLS,
privilege, and function evidence incomplete. No Production mutation occurred.
The corrected R6-2 and R6-6 packets each use one catalog-only CTE statement and
emit one ordered redacted check table. Capture R6-2 outside Git and validate it
with `scripts/validate-operational-guardrails-r6-single-result.mjs` using the
safe operator-bound target marker. R6-6 must be validated against those saved
redacted baseline fingerprints; a missing or mismatched baseline fails closed.

Only `FUNCTION_ABSENT_SAFE_TO_CREATE` permits the unexecuted R2 proposal through
the execution wrapper. `EXACT_FUNCTION_ALREADY_PRESENT` skips creation and runs
R6-6; `CONFLICTING_FUNCTION_PRESENT` and `INSUFFICIENT_EVIDENCE` stop. The
previous execution approval is not reusable. The next possible approval is
`APPROVE_R6_STAGE1_RESUME_WITH_CORRECTED_SINGLE_RESULT_PACKETS`.

The expected function is
one overload owned by `postgres`, `SECURITY DEFINER`, `VOLATILE`, `PARALLEL
UNSAFE`, non-leakproof, with `pg_catalog, public, pg_temp`, 1s lock timeout, 3s
statement timeout, service-role-only execute, and no table grant or policy
change. A lost/ambiguous connection is never retried: inspect catalog and
classify committed, not committed, or conflicting.

Runtime deployment is blocked until binding and SQL postflight pass. It must
deploy the approved merge commit only, confirm target/ref equality with SQL,
and prove no direct `forum_upload_attempts` runtime access or client
service-role exposure.

## Canary and rollback

Canary fixtures use unique operator identifiers, isolated accounts, deterministic
cleanup, and residue verification. Test one read route/session, one post, one
comment, one deterministic-cleanup circle, one minimal media reservation, and
one minimal external-video signing flow. Do not exhaust quotas or run
concurrency tests in Production. Classify `PRODUCTION_CANARY_PASSED`,
`PRODUCTION_CANARY_FAILED_ROLLBACK_REQUIRED`,
`PRODUCTION_CANARY_INCONCLUSIVE`, or `PRODUCTION_CANARY_CLEANUP_FAILED`.

Rollback runtime by restoring the immediately preceding known-good deployment
and verifying its commit. For binding failure, roll back runtime first and only
remove/correct the secret under separate approval. For SQL ambiguity, use only
catalog inspection. For an RPC defect, rollback runtime and use a separately
approved exact restore proposal; never improvise SQL. Canary cleanup failure is
fatal and blocks Stage C. Every rollback ends with redacted residue proof.

## Stage C hold

`forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self`
remain `BLOCKED_RUNTIME_MIGRATION_REQUIRED`. Their prepared cleanup packet may
run only after R6 SQL, runtime, canary, and residue success, with a separate
approval: `APPROVE_R7_PRODUCTION_STAGE_C_REDUNDANT_POLICY_CLEANUP_STAGED_EXECUTION`.
