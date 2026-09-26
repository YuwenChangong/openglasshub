# Verified Session v1 AUTH-A mechanism review

**OFFLINE REVIEW ONLY. NOT AUTHORIZED. ZERO EXTERNAL REQUESTS.**

AUTH_RELEASE_STATUS=NO_GO
AUTH_A_001_STATUS=VOID_UNEXECUTED
AUTH_A_001_EXTERNAL_REQUESTS=0
AUTH_A_001_REUSABLE=false
MECHANISM_FREEZE_STATUS=BLOCKED

This file records the exact local implementation and the remaining review blockers. It is not a Production command, an AUTH-A receipt, or permission to reuse `auth-a-verified-session-001`. All new provider clients and the database aggregator are hard-disabled for Production until a separately reviewed orchestrator and a new human authorization exist.

## Mechanism inventory

DATABASE_MECHANISM=LOCAL_TEST_PROVEN_PRODUCTION_DISABLED
CLOUDFLARE_MECHANISM=LOCAL_MOCK_PROVEN_PRODUCTION_DISABLED
SUPABASE_MECHANISM=NOT_FROZEN
BREVO_MECHANISM=LOCAL_MOCK_PROVEN_PRODUCTION_DISABLED
SUPABASE_TWO_READS_SUFFICIENT=false
MECHANISM_SCOPE_REVIEW_REQUIRED=true

| Class | Exact proposed read | Ceiling | Credential source class | Current local evidence |
| --- | --- | --- | --- | --- |
| PostgreSQL | One P9 transport process/session containing 11 catalog `SELECT` units from `docs/ops/verified-session-v1-hosted-catalog-preflight.sql`, then one migration-history `SELECT` from `docs/ops/p9-migration-history-rows-read-only.sql` | One connection attempt, one session, 12 frozen query units, zero retry | Existing `P9_PRODUCTION_DATABASE_URL`; never printed | `scripts/qa/verified-session-auth-a-db-capture.mjs` and its local mock tests. Production mode disabled. |
| Cloudflare | `GET /client/v4/accounts/{account_id}/workers/scripts/openglasshub/deployments`; then `GET /client/v4/accounts/{account_id}/workers/scripts/openglasshub/versions/{version_id}` where the ID comes from the first response | Two requests; no pagination, redirects or retry | Existing read-capable `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; values never printed | `scripts/qa/verified-session-auth-a-cloudflare-read.mjs` with loopback HTTP fixtures. Production mode disabled. |
| Supabase control plane | Candidate `GET /v1/projects` and `GET /v1/organizations/{slug}` are **not frozen**; no documented two-read combination in this worktree proves remaining DB/Auth/email capacity for the bounded AUTH-B..E campaign | Existing packet says two, but no client or dispatch exists | Existing read-capable `SUPABASE_ACCESS_TOKEN`; value never printed | Insufficient offline endpoint/response/remaining-quota evidence. No request made. |
| Brevo | `GET /v3/account`; then `GET /v3/senders` | Two requests, no redirects or retry | Existing server-side `BREVO_API_KEY` and expected `BREVO_VERIFIED_SENDER_EMAIL`; values never printed | `scripts/qa/verified-session-auth-a-brevo-read.mjs` with loopback HTTP fixtures. Production mode disabled. |

`scripts/qa/verified-session-auth-a-read-client.mjs` enforces local loopback, fixed GET path allowlists, an in-code pre-dispatch counter, manual redirect handling, exact HTTP 200, bounded JSON bodies, and generic error codes. It never exposes response JSON or request headers in shared output. Local tests use dummy token/sender values. Provider response shapes in these fixtures are candidates, not hosted observations; an unexpected real shape must be `UNKNOWN/BLOCKED`, not coerced to a match.

## Database contract and P9 regression finding

The new aggregator verifies the two raw worktree byte hashes independently: catalog `f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8` and history `1f4178d5b13fecd07160fe464f5edb9bcb4d6db9263324c2381e0b26c3cd4198`. It reuses `loadReadOnlyPacketUnits` to reject non-SELECT units, fixes `CATALOG_01` through `CATALOG_11` and `HISTORY_01`, combines the original bytes only in memory, and uses `runP9ReadOnlyCapture` without changing P9 transport or either SQL packet. The P9 transcript itself supplies `BEGIN READ ONLY`, `transaction_read_only=on`, matching backend PID, `ON_ERROR_STOP`, explicit `ROLLBACK`, shell-free one-process execution, target allowlist and zero retry. The wrapper returns only whitelisted status/count/hash fields, not P9's raw per-query rows.

The pre-existing P9 regression suite currently has five hash failures in this Windows worktree: checked-out SQL has CRLF bytes, while the older P9 constants refer to LF-byte hashes. For the history packet the worktree SHA-256 is `1f4178d5...`, while its old P9 constant is `6018ce14...`; LF normalization reproduces the old constant. This is **not** an AUTH-A permission to rewrite the SQL packets, normalize the authorized bytes at execution time, or change legacy P9 caller semantics. The new aggregator binds the currently reviewed raw worktree bytes. An independent review must resolve the P9 regression expectation before any READY claim. Local mock transcript tests do not yet substitute for a disposable real Postgres/Supabase single-session acceptance run.

## Cloudflare identity limit

The two candidate paths match GET methods present in the locally installed Cloudflare SDK bundled with Wrangler. The local parser requires one active 100% version and a matching version ID, name and environment; it retains only binding names/types and non-secret compatibility metadata. It does not claim a source commit from an unverified metadata field. An immutable version ID and an opaque ETag are not, by themselves, the independently reviewed old-build artifact digest/configuration fingerprint demanded by the AUTH-A packet. If those cannot be obtained and matched within the two-read budget, deployed Worker identity remains `UNKNOWN` and AUTH-A must block. No opaque Wrangler command or Worker invocation is used.

## Supabase capacity semantic correction

`Free` plan identity, `ACTIVE_HEALTHY` project status and remaining quota are separate facts. The candidate two Management API reads have no locally reviewed response contract proving remaining storage, Auth and email capacity for the later bounded campaign; therefore `SUPABASE_TWO_READS_SUFFICIENT=false`. It would be unsafe to manufacture `FREE_CAPACITY_STATUS=PASS` from a plan label. The offline packet `docs/ops/verified-session-v1-auth-a-authorization.md` now separates inventory PASS from the capacity gate: unknown remaining capacity sets `CAPACITY_GATE=BLOCKED_BEFORE_AUTH_B` and requires a separate, explicitly authorized read-only capacity review before **any** later mutation stage. This correction changes the packet SHA-256 and voids any attempt to use the old packet/authorization. It needs independent review and a new human authorization; it is not self-approved.

## Failure and execution boundary

- Methods: GET only for provider candidates; DB units are SELECT only. No POST/PUT/PATCH/DELETE, Worker smoke, Auth call, migration, mail, KV/R2 write or configuration change exists in these modules.
- Endpoints: only the fixed patterns above. A version path is derived from the sole deployment response. No pagination, redirected host, arbitrary URL or alternate provider command.
- Budgets: provider counters increment before dispatch and refuse the third request. The P9 transport is invoked once; no retry/reconnect code exists in the aggregator.
- Identity: exact project ref `xcbnxzjlsvtgzixurcof` and Worker `openglasshub`/Production must be proven from observed evidence before a future database session. Local fixtures do not prove hosted target or capacity.
- Output: shared evidence omits credential values, sender email, account PII, raw provider JSON, database URI, session ID, OTP and raw catalog rows. Local failure messages contain reason codes only.
- Production: hard-disabled in each new client. No orchestrator was created because the Supabase and independent-review prerequisites are incomplete. A future orchestrator must require a new ID (never `auth-a-verified-session-001`), strict UTC, exact source/packet hash and `AUTH_A_EXECUTE=1`, and must stop after one attempt.

Execution order remains source/hash/new-authorization validation, Cloudflare read, Supabase/Brevo read, target gate, one DB session, semantic catalog classification, migration provenance, capacity gate, redacted receipt, then stop. This order is a non-executable contract, not a runnable command.

## Local verification

The local tests are `node --test scripts/qa/test-verified-session-auth-a-db-capture.mjs`, `node --test scripts/qa/test-verified-session-auth-a-read-client.mjs`, `node --test scripts/qa/test-verified-session-auth-a-cloudflare-read.mjs`, and `node --test scripts/qa/test-verified-session-auth-a-brevo-read.mjs`. The existing P9 regression commands and release test are listed in the implementation task; any failing baseline must be reported, not hidden. No mock fixture or unit test confers Production authorization.

NEXT_ACTION=INDEPENDENT_SECURITY_REVIEW_OF_PACKET_AND_PARTIAL_MECHANISMS_THEN_NEW_SCOPE_DECISION
