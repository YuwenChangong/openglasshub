# Verified Session v1 AUTH-A authorization packet

**NOT AUTHORIZED. READ-ONLY PRODUCTION INVENTORY ONLY. ZERO MUTATIONS. SINGLE USE.**

PACKET_STATUS=NOT_AUTHORIZED
AUTH_RELEASE_STATUS=NO_GO
AUTH_A_EXECUTION_STATUS=NOT_STARTED

This is an offline review packet, not an execution command or approval. It authorizes nothing by itself. AUTH-A may be attempted only after a human approves one exact `auth-a-verified-session-<digits>` identifier and binds the target, immutable artifacts, observation methods, read budgets, and operator. AUTH-B through AUTH-F require their own later single-use authorizations. No stage advances automatically.

## Locked local inputs

| Input | Reviewed identity |
| --- | --- |
| Branch and packet-preparation source | `feature/auth-verified-session-v1` at `c7bf0326f9ec8916ffb50807372e3e17b889e48a` |
| Pinned old Worker source expectation | `e6c2141be8827d961fc49462d66be8da9b4993eb` |
| Pinned reviewed new Worker source | `6e7e1622234b89209f0307d088900526bf2dfc7f` |
| Foundation | `supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql`; SHA-256 `575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9` |
| Enforcement | `supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql`; SHA-256 `89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e` |
| Read-only catalog packet | `docs/ops/verified-session-v1-hosted-catalog-preflight.sql`; SHA-256 `f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8` |
| Existing migration-history metadata packet | `docs/ops/p9-migration-history-rows-read-only.sql`; SHA-256 `1f4178d5b13fecd07160fe464f5edb9bcb4d6db9263324c2381e0b26c3cd4198` |

Both pinned source commits exist locally. These hashes were recomputed from the files in the reviewed worktree; a future operator must recompute and bind them again before any hosted read. A mismatch means `AUTH_A_PACKET_STATUS=BLOCKED_ARTIFACT_DRIFT` and stop. The AUTH-A execution authorization must bind the *then-current* packet commit and packet-file SHA-256; this preparation commit is not an approval or a claim about the deployed Worker.

The governing contracts are `docs/ops/verified-session-v1-hosted-readiness.md`, `docs/ops/verified-session-v1-release-gates.md`, `docs/ops/verified-session-v1-cutover-rollback.md`, `docs/superpowers/specs/2026-09-25-verified-session-v1-cutover-bridge-design.md`, and `docs/superpowers/plans/2026-09-25-verified-session-v1-cutover-bridge.md`. The final release remains `NO_GO` after a successful AUTH-A.

## Exact target and allowed observation classes

Expected canonical Production Worker origin is `https://openglasshub.ogh.workers.dev`, Worker name is `openglasshub`, Worker environment is `production`, and configured Production Supabase project reference is `xcbnxzjlsvtgzixurcof` (`wrangler.toml`). The preview Worker points at the same Supabase project and is not an isolated target. A future operator must compare these expectations with independently observed provider target identifiers *before* opening the database session. Repository configuration alone is not target proof. Any mismatch is `TARGET_MATCH=false`, `AUTH_A_RESULT=NO_GO`, and stop. Never include a connection string, secret key, token, or password in the receipt.

| Observation class | Maximum future attempts/requests | Permitted evidence | Excluded |
| --- | --- | --- | --- |
| Production PostgreSQL Session Pooler | One connection attempt, one session, no reconnect | The reviewed catalog packet and separately bound migration-history metadata packet in a read-only transaction; exact target identity, catalog and provenance metadata only | User/application rows, mutations, migration repair, test fixtures |
| Cloudflare control-plane read | Two requests, zero retries | Current `openglasshub` Production deployment/version identity, immutable version or artifact digest if exposed, environment and non-secret binding names/types | Deploy, Worker invocation/smoke, secret values, KV/R2/route/config mutation |
| Supabase control-plane read | Two requests, zero retries | Project identity, non-secret signing configuration, plan/usage metadata if safely exposed | Auth sign-in, `getClaims` with a real account, user/session reads, template test, settings mutation |
| Brevo control-plane read | Two requests, zero retries | Verified-sender status and non-secret Free-plan/remaining-quota metadata if safely exposed | Sending mail, reading API-key value, template send/test, plan change |

Provider read mechanisms and their exact permissions must be independently reviewed and bound in the later execution authorization; this packet invents no endpoint or CLI. If any observation needs more than the enumerated requests, cannot prove it is read-only, or encounters an ambiguous response, stop and request a new scope. No polling, automatic retry, second database connection, Worker HTTP probe, or alternative SQL client is implicitly permitted. Provider dashboard observation is subject to the same zero-mutation and redacted-evidence rules.

## Database catalog and semantic stage

Use only the existing `docs/ops/verified-session-v1-hosted-catalog-preflight.sql` for the catalog observation, without widening it to row-level data. It reads catalog metadata for the four `private.ogh_*` tables (names, columns, constraints, indexes, RLS, owner and effective role privileges), eight `public.ogh_*` function identities/bodies/owners/return types/search paths/effective EXECUTE, resend RPC identity/body/fixed-policy markers/effective EXECUTE, `ogh_verified_*` public and Storage policies, relevant Realtime publication membership, and `auth.sessions` **column metadata only**. Its private-schema lookup is null-safe at PRE_V1. It does not read `auth.sessions`, `auth.users`, challenge, Storage object, forum, or private user rows.

The observed catalog must be normalized to the reviewed `scripts/lib/verified-session-db-stage.mjs` contract and compared with the locked local A/B/D expectations in `scripts/test-verified-session-db-stage.mjs`: exact schema/object/table/column/constraint/index/function/policy/RLS/ACL/publication families. A partial, mixed, unexpected, or insufficient snapshot is `DB_STAGE=UNKNOWN`, never a guessed stage. The only labels are `PRE_V1`, `FOUNDATION`, `ENFORCEMENT`, and `UNKNOWN`. Migration filenames or history version numbers alone never classify the stage. Before AUTH-B, require `DB_STAGE=PRE_V1`, zero v1 private tables, zero v1 functions, zero v1 restrictive policies, and baseline resend identity/grants. `FOUNDATION`, `ENFORCEMENT`, or `UNKNOWN` blocks AUTH-B pending review.

## Migration provenance

Within the **same one** read-only database session, the separately bound existing `docs/ops/p9-migration-history-rows-read-only.sql` may observe `supabase_migrations.schema_migrations` metadata (`version`, `name`, creator/idempotency metadata and statement/rollback counts). It must not emit migration SQL bodies, user rows, or credentials. This is a provenance read, not a migration execution or history change. The reviewed catalog packet alone cannot answer historical application.

Check these four exact filename stems (allow only the ledger's documented `.sql` normalization):

| Receipt fact | Version | Name stem | Expected before AUTH-B |
| --- | --- | --- | --- |
| `OLD_MONOLITH_APPLIED` | `20260923000000` | `ogh_verified_session_v1` | `false` |
| `OLD_RESEND_LOCK_APPLIED` | `20260925012231` | `lock_verification_email_resend_limit` | `false` |
| `NEW_FOUNDATION_APPLIED` | `20260923000000` | `ogh_verified_session_v1_foundation` | `false` |
| `NEW_ENFORCEMENT_APPLIED` | `20260925012231` | `ogh_verified_session_v1_enforcement` | `false` |

Old and new artifacts reuse two version numbers. A version-only match cannot distinguish them. Ledger name, statement count, and current catalog must be reconciled with authoritative deployment/audit provenance for the exact target; the count is not a content hash, and an absent current row cannot by itself prove a migration was **never** applied manually or later removed. If the history lacks names, shows either old/new name, conflicts with catalog, has a duplicate/collision, or cannot establish historical completeness/content attribution, report `MIGRATION_PROVENANCE=UNKNOWN` and `AUTH_A_RESULT=NO_GO`. Do not rewrite history, infer absence from the repository, or silently rename a deployed migration. `CLEAN_UNSHIPPED_V1` requires affirmative, independently reviewed evidence that all four are absent and no equivalent v1 effect was applied, plus semantic `PRE_V1`.

## Deployed Worker identity

Observe the actual current Production deployment rather than treating the pinned old commit as deployed. Record canonical Worker name/environment, immutable deployment/version identifier, creation metadata and non-secret binding names/types. Record an exposed script/artifact digest only if the provider's read-only metadata actually supplies it. A source commit is `UNKNOWN` unless provider-attested metadata binds it; a version ID alone is not a source commit. If source attribution is unavailable, the fallback identity is the immutable deployed version ID **plus** independently obtainable artifact digest and configuration/environment fingerprint, bound to a separately reviewed old-build artifact. If any component or the independent match is unavailable, set `DEPLOYED_WORKER_IDENTITY_MATCH=false`, `DEPLOYED_WORKER_IDENTITY_DRIFT=UNKNOWN`, and block AUTH-B. A provable mismatch sets `DEPLOYED_WORKER_IDENTITY_DRIFT=true`. Do not guess old/new from behavior or deploy during AUTH-A.

## Signing, provider and free-capacity boundary

| Fact | AUTH-A classification | Rule |
| --- | --- | --- |
| Supabase signing mode and documented official claims path | `READ_ONLY_SAFE` for provider configuration only | Record asymmetric/JWKS versus symmetric/Auth verification as observed, or `UNKNOWN`; no real JWT or account operation |
| Genuine `getClaims`, signed `session_id`, password `amr`, refresh and live `auth.sessions` proof | `DEFER_TO_AUTH_E` | Requires owned sessions and Auth state changes; zero AUTH-A Auth calls |
| Signup template configuration, including six-digit `{{ .Token }}` | `READ_ONLY_SAFE` only if exposed as non-secret configuration within the bound Supabase read budget; otherwise `DEFER_TO_AUTH_E` | No OTP request, preview send or recipient data |
| Brevo verified sender and Free-plan remaining quota | `READ_ONLY_SAFE` only for non-secret provider metadata within the bound Brevo budget; otherwise `DEFER_TO_AUTH_E` | No email, API-key value or provider mutation |
| Brevo transactional key usability and actual email delivery | `DEFER_TO_AUTH_E` | Cannot be certified from metadata alone |

`ZERO_PAID_INFRA=true`: no new Supabase project or paid branch, Cloudflare paid service, paid email tier, SMS, overage or automatic upgrade. Record `FREE_CAPACITY=UNKNOWN` if current free capacity cannot be positively established through the bounded read-only metadata. In that case AUTH-A may retain catalog evidence but `AUTH_A_RESULT=NO_GO`; no later stage whose writes might exceed unknown capacity may begin. Provider uncertainties do not become optimistic PASS values.

## Frozen mutation and failure limits

MAX_PRODUCTION_CONNECTION_ATTEMPTS=1
MAX_READ_ONLY_DATABASE_SESSIONS=1
MAX_DATABASE_WRITES=0
MAX_AUTH_STATE_CHANGES=0
MAX_EMAIL_SENDS=0
MAX_STORAGE_WRITES=0
MAX_REALTIME_SENTINELS=0
MAX_DEPLOYS=0
MAX_CONFIG_CHANGES=0
AUTOMATIC_RETRY=false
MANUAL_RETRY_WITH_SAME_AUTHORIZATION=false

One attempted external run consumes its authorization whether it passes, fails, or becomes ambiguous. Stop on target, artifact, catalog, provenance, provider, capacity or identity uncertainty. No automatic AUTH-B request is an execution permission. No `qa:prod`, migration, Auth call, email, deploy, Cloudflare mutation, database write, or user-data query belongs to AUTH-A.

## Fields for a later human authorization

These fields are deliberately **unfilled**. The approving human and execution reviewer must bind the exact read-only mechanisms, target and budgets before any hosted request. `AUTHORIZED_AT_UTC` must be the machine-current UTC time at actual authorization, never backfilled.

```text
AUTHORIZATION_ID=<auth-a-verified-session-NNN>
AUTHORIZED_AT_UTC=<machine-current-UTC-at-authorization>
AUTHORIZED_BY=<human-approver>
TARGET=<exact-Production-Worker-and-Supabase-project>
SOURCE_HEAD=<reviewed-current-commit>
PACKET_SHA256=<hash-of-this-committed-packet>
CATALOG_PACKET_SHA256=f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8
MIGRATION_HISTORY_PACKET_SHA256=1f4178d5b13fecd07160fe464f5edb9bcb4d6db9263324c2381e0b26c3cd4198
MAX_READ_ONLY_CONNECTIONS=1
MAX_CLOUDFLARE_READ_REQUESTS=2
MAX_SUPABASE_CONTROL_PLANE_READ_REQUESTS=2
MAX_BREVO_READ_REQUESTS=2
MAX_WRITES=0
AUTOMATIC_RETRY=false
REUSABLE=false
```

`AUTHORIZATION_ID` must match `^auth-a-verified-session-[0-9]+$` when the human later supplies it. No ID, timestamp, credential, or authorization is created by this packet.

## Future redacted execution receipt contract

The later AUTH-A attempt, if separately approved, reports only non-secret identity, boolean, count, status and digest facts. Unknown is an explicit outcome, never coerced to false or PASS.

```text
AUTH_A_STATUS=PASS|BLOCKED
AUTH_RELEASE_STATUS=NO_GO
AUTHORIZATION_ID=<approved-id>
AUTHORIZATION_CONSUMED=true|false
TARGET_WORKER=<observed-name/environment/version-id>
TARGET_SUPABASE=<observed-project-ref>
TARGET_MATCH=true|false
DEPLOYED_WORKER_IDENTITY=<attested-source-or-immutable-version/artifact/config-digests-or-UNKNOWN>
DEPLOYED_WORKER_IDENTITY_MATCH=true|false
DEPLOYED_WORKER_IDENTITY_DRIFT=true|false|UNKNOWN
DB_STAGE=PRE_V1|FOUNDATION|ENFORCEMENT|UNKNOWN
EXPECTED_DB_STAGE=PRE_V1
MIGRATION_PROVENANCE=CLEAN_UNSHIPPED_V1|UNKNOWN|DIVERGENT
OLD_MONOLITH_APPLIED=true|false|UNKNOWN
OLD_RESEND_LOCK_APPLIED=true|false|UNKNOWN
NEW_FOUNDATION_APPLIED=true|false|UNKNOWN
NEW_ENFORCEMENT_APPLIED=true|false|UNKNOWN
V1_PRIVATE_TABLE_COUNT=<integer-or-UNKNOWN>
V1_FUNCTION_COUNT=<integer-or-UNKNOWN>
V1_RESTRICTIVE_POLICY_COUNT=<integer-or-UNKNOWN>
RESEND_EFFECTIVE_ACL=<non-secret-role-summary-or-UNKNOWN>
CATALOG_PREFLIGHT_STATUS=PASS|FAIL|UNKNOWN
CATALOG_DRIFT=none|<non-secret-summary>|UNKNOWN
FREE_CAPACITY_STATUS=PASS|UNKNOWN|FAIL
PRODUCTION_CONNECTION_ATTEMPTS=<0-or-1>
PRODUCTION_WRITES=0
AUTH_STATE_CHANGES=0
EMAIL_SENDS=0
STORAGE_WRITES=0
REALTIME_SENTINELS=0
DEPLOYS=0
CONFIG_CHANGES=0
NEXT_ACTION=REQUEST_AUTH_B_FOUNDATION_AUTHORIZATION|STOP_FOR_REVIEW
```

`AUTH_A_STATUS=PASS` is permitted only with exact target and deployed-old identity match, semantic `PRE_V1`, complete `CLEAN_UNSHIPPED_V1` provenance, the expected empty v1 inventory and baseline resend ACL, catalog preflight PASS/no drift, and positively established free capacity. Even then `AUTH_RELEASE_STATUS=NO_GO`; `NEXT_ACTION=REQUEST_AUTH_B_FOUNDATION_AUTHORIZATION` requests a **new** decision, not an automatic migration. Every other outcome is BLOCKED/`STOP_FOR_REVIEW`. Keep raw provider output, SQL text/results and any identifiers that could reveal secrets out of the shared receipt.
