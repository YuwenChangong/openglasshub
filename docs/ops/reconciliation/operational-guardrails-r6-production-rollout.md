# R6 Production Rollout Packet

Status: `R6_STAGE1_BINDING_READY` (repository-only). This packet
does not authorize a cloud connection, secret creation, SQL execution, merge,
or deployment. `R5_PREVIEW_BLOCKED_TARGET_IDENTITY` remains in force because
hosted Preview uses Production data; local R5L is evidence, not Preview
verification. `SUPABASE_SERVICE_ROLE_KEY` is present as an encrypted Production
secret under operator-held metadata proof. The repository has removed the raw
legal-consent and deprecated generic factories; its exact narrow-consumer
allowlist is `R6_STAGE1_BINDING_READY`. Binding metadata classification remains
`PRODUCTION_BINDING_METADATA_READY`.

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

R6-B1 records Production-only metadata preflight. R6-B2 created the encrypted
server-only secret under separate explicit approval. R6-B3 proved metadata
only; it never logged, hashed, read, or exported the value. R6-B4 found no
browser asset or rendered-HTML exposure and Preview remained unchanged. R6-F
now blocks the next checkpoint until every direct source consumer keeps the raw
client within a purpose-specific server-only operation boundary. Runtime value
correctness is still proved only by the canary.

## SQL and runtime gates

The former R6-2 packet was connector-incompatible: the available connector
discarded every result set except the last, leaving relation, index, RLS,
privilege, and function evidence incomplete. No Production mutation occurred.
The once-executed corrected R6-2 packet returned 15 redacted rows: 14 passed and
the blocking `resend_separation` check failed because it named
`public.consume_verification_email_resend`, not the exact source-backed
`public.consume_verification_email_resend_limit(text,integer,integer)` contract.
No Production mutation, secret creation, deployment, or policy change occurred.
The R6 resend identity review records this source-backed expectation defect.
The corrected R6-2 and R6-6 packets each use one catalog-only CTE statement and
emit one ordered redacted check table. Capture R6-2 outside Git and validate it
with `scripts/validate-operational-guardrails-r6-single-result.mjs` using the
safe operator-bound target marker. R6-6 must be validated against those saved
redacted baseline fingerprints; a missing or mismatched baseline fails closed.

Use `scripts/capture-operational-guardrails-r6-single-result.mjs` for connector
responses. It accepts only the exact committed output columns and safe catalog
identifiers, including `service_role`; it rejects actual credential-shaped
content before writing any evidence. The durable operator-held artifact is a
canonical JSON packet plus SHA-256 sidecar, reopened and validated before a
later checkpoint may rely on it.

The helper's CLI accepts the connector response only as base64url JSON, performs
the schema and sensitive-content checks in memory, and writes no packet on a
rejection. Its output is a safe status/classification summary, never connector
content. The base64url argument is transport-only and must not be logged or
retained after capture.

Connector envelope structure capture uses the separate Node-only bridge at
`scripts/capture-operational-guardrails-r6-envelope-structure.mjs`. That bridge
accepts only one UTF-8 JSON payload on stdin or one in-process object handoff,
never raw connector JSON on argv, never PowerShell interpolation, and never
browser globals such as `btoa` or `atob`. It writes only a safe status summary
and passes the response directly to the value-blind structure recorder.

The approved constant-only probe proved one exact connector wrapper path:
`$[0].text#json.result#wrapped_json`. The adapter in
`scripts/capture-operational-guardrails-r6-single-result.mjs` accepts only that
exact fenced wrapper path and the existing direct local row-array path; any
other text prefix/suffix, wrapper key, or contradictory result shape fails
closed.

Only `FUNCTION_ABSENT_SAFE_TO_CREATE` permits the unexecuted R2 proposal through
the execution wrapper. `EXACT_FUNCTION_ALREADY_PRESENT` skips creation and runs
R6-6; `CONFLICTING_FUNCTION_PRESENT` and `INSUFFICIENT_EVIDENCE` stop. The
previous execution approval is not reusable. The next possible approval is
`APPROVE_R6_STAGE1_RESTART_WITH_RESEND_RECONCILED_PACKETS`.

The expected function is
one overload owned by `postgres`, `SECURITY DEFINER`, `VOLATILE`, `PARALLEL
UNSAFE`, non-leakproof, with `pg_catalog, public, pg_temp`, 1s lock timeout, 3s
statement timeout, service-role-only execute, and no table grant or policy
change. A lost/ambiguous connection is never retried: inspect catalog and
classify committed, not committed, or conflicting.

## R6-6 compact evidence recovery

The approved R6-5 mutation was submitted once and must never be replayed. The
original full R6-6 result was not persisted after connector output exceeded the
capture budget, so its state is
`CATALOG_STATE_UNVERIFIED_AFTER_SINGLE_MUTATION_SUBMISSION`. The recovery query
is a distinct one-row, read-only catalog packet. It reports only fixed
booleans, counts, and redacted MD5 fingerprints for the target function,
protected table inventory, prerequisite indexes, and resend RPC. It excludes
function bodies, application rows, auth-user fields, credentials, and raw
catalog source text.

Before a recovery query is issued, the repository packet guard, capture-budget
test, validator, and local Docker mirror must pass. The mirror runs the full
reviewed postflight and compact packet on the same disposable committed state;
the semantic matrix separately covers exact, absent, all defined unsafe/drift
states, and insufficient/contradictory evidence. The compact packet remains
below 8 KiB. One query may then be submitted through the proven envelope path,
captured immediately by the dedicated bridge outside Git, and compared to the
operator-held R6-2 baseline. Any capture, schema, baseline, or classification
failure stops without a supplementary query or R6-5 replay.

The first compact recovery capture rejection retained only a row-count
classification, not structural connector evidence. R6I is repository-only: it
adds a value-blind diagnostic record for a future separately approved query but
does not infer or accept an unproven direct-object result shape. Production
catalog state remains unverified.

R6J then stopped before dispatch because the runner's derived failure filename
did not match the separately approved R6 recovery evidence path. R6K changes
only the repository capture contract: an operator can now provide exact
outside-Git failure JSON/SHA destinations and send the connector response only
on stdin. The runner writes those names directly and never uses a post-capture
rename. No Production SQL, mutation, deployment, or binding change occurred.

R6J2 subsequently submitted exactly one compact, read-only recovery query. Its
ad hoc PowerShell stdin handoff failed before JSON parsing, leaving all five
approved v2 evidence paths absent. The available parser error cannot establish
whether the pipe truncated, closed early, skipped a write, or transformed UTF-8,
so the root cause remains `TRANSPORT_ROOT_CAUSE_INSUFFICIENT`. It separately
exposes `RUNNER_PREPARSE_FAILURE_EVIDENCE_DEFECT`: the old runner initialized
its failure path after parsing. R6L is repository-only and corrects that order
with a checked-in Node Buffer/stdin transport, hard size/UTF-8/EOF checks,
atomic value-blind pre-parse failure evidence, and deterministic synthetic
tests. No Production or cloud action occurred. The next action needs fresh
approval: `APPROVE_R6M_ONE_COMPACT_READ_ONLY_RECOVERY_EXECUTION_WITH_HARDENED_TRANSPORT`.

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
