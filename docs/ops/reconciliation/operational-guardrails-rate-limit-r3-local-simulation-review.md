# W6 R3 Local Disposable Simulation Review

Status: `R3_PASSED_LOCAL_DISPOSABLE_ONLY`. This is local Docker evidence, not
Preview or Production evidence. The overall release state remains
`LEGAL_TRUST_CONSENT_FOUNDATION_V1_PRODUCTION_RECONCILIATION_NO_GO`.

## Isolation and baseline

- Runner: `scripts/test-operational-guardrails-rate-limit-r3-local.mjs`.
- PostgreSQL: pinned local image
  `public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453`.
- One unique named container and one unique database per run; Docker network
  is `none`, no port is published, and data is held in a container tmpfs.
- `POSTGRES_HOST_AUTH_METHOD=trust` exists only inside that isolated no-network
  container. No credential, secret, Cloudflare, Supabase, Preview, or
  Production target is read or used.
- Schema baseline: `MINIMAL_SOURCE_BACKED_FIXTURE`, not a full-schema replay.
  It reproduces only the required `forum_upload_attempts` columns, constraints,
  purpose values, five source-backed secondary indexes, RLS-enabled state, and
  four current policies from `20260531_forum_phase6_upload_guardrails.sql`,
  `20260605_forum_rate_limit_purposes.sql`, and
  `20260607_auth_resend_confirmation_limit.sql`.

## Exact proposal and corrections

The locally executed unexecuted proposal was
`operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` with SHA-256
`10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`.

R3 found and corrected two deterministic repository artifacts before the final
fresh run:

1. The external-video accumulator used a schema-qualified `coalesce`, which is
   not a PostgreSQL function name and failed on a `sum(bigint)` result. The
   proposal now uses `COALESCE(pg_catalog.sum(bytes), 0::numeric)` with a
   numeric accumulator. The 300 MiB contract and lock ordering are unchanged.
2. The static postflight CTE referenced `functions.proowner` without selecting
   `p.proowner`. The read-only catalog query now selects that OID and has a
   regression assertion.

Both fixes were validated through a new disposable database. No production SQL
or migration was executed.

## Behavior and concurrency results

| Scenario | Verified result |
| --- | --- |
| `post_create` | 10 allowed, 11th rate limited; nonzero bytes rejected. |
| `comment_create` | 60 allowed, 61st rate limited; nonzero bytes rejected. |
| `circle_create` | 5 allowed, 6th rate limited; database-clock rolling 24-hour boundary honored. |
| `post_media_upload` | 1 and 157286400 bytes accepted; 0, negative, and 157286401 rejected; 11th shared-IP request rate limited. |
| `external_video_upload` | 1 and 157286400 bytes accepted; two 157286400-byte reservations total exactly 314572800; a third maximum request and one additional byte are rate limited with no new row. |
| `verification_email_resend` | Rejected with no row; it remains the separate RPC contract. |
| Invalid input | Null identity/purpose/bytes, malformed hash, invalid purpose, negative bytes, and bigint overflow reject without ledger residue. |
| Return shape | Every successful call returns exactly `allowed` and `decision`; decisions are only `ALLOWED` or `RATE_LIMITED`. |

Real concurrent local sessions produced: one remaining user slot `1 allowed / 5
rate-limited`; empty user scope `10 allowed / 1 rate-limited`; shared media IP
scope `10 allowed / 1 rate-limited`; and the external-video final-byte boundary
`1 allowed / 4 rate-limited`. Maximum observed accepted external-video bytes
was exactly `314572800`. Independent user, IP, and purpose scopes did not
block one another. The implementation uses one transaction-scoped advisory
lock per invocation; no session advisory lock or multi-lock deadlock path is
present.

## Failure, ACL, and cleanup results

- A held advisory lock produced the reviewed one-second lock timeout and left
  no attempt row.
- A local test-only four-second insert trigger timed out when the caller session
  had the reviewed three-second statement deadline; no row remained. The
  function catalog setting is verified separately; a caller/runtime deadline is
  still required because PostgreSQL measures statement timeout from outer
  statement start.
- A local test-only forced insert error rolled back with no row. Accepted
  reservations remain charged when a simulated later workflow failure occurs
  outside the RPC, as intended.
- `PUBLIC`, `anon`, and `authenticated` cannot execute the function.
  `service_role` can execute it without table `SELECT` or `INSERT` grants.
- Postflight verified exactly one overload, `postgres` owner, `SECURITY
  DEFINER`, volatile, parallel unsafe, non-leakproof, fixed search path and
  timeouts, only `service_role` execute, four unchanged policies, and six
  fixture indexes. The fixture intentionally omits the resend RPC; that is not
  a production absence claim.
- Each successful run records its local row count before teardown, drops the
  unique database, removes the unique container, and verifies neither its
  container nor a same-named volume remains. The final run passed cleanup.

## Remaining blocks

R3 does not create a production function, grant, policy change, runtime route
change, service-role binding, deployment, or migration. Stage C remains
`BLOCKED_RUNTIME_MIGRATION_REQUIRED`; production identity remains
`BINDING_ABSENT_PRODUCTION_BLOCKED`; the two extra policies remain unchanged.
The next possible approval is
`APPROVE_R4_REPOSITORY_ONLY_FAIL_CLOSED_RUNTIME_MIGRATION_PROPOSAL`.
