# Verified Session v1 AUTH-A mechanism review

**OFFLINE REVIEW ONLY. NOT AUTHORIZED. ZERO EXTERNAL REQUESTS.**

AUTH_RELEASE_STATUS=NO_GO
AUTH_A_001_STATUS=VOID_UNEXECUTED
AUTH_A_001_EXTERNAL_REQUESTS=0
AUTH_A_001_REUSABLE=false
MECHANISM_FREEZE_STATUS=BLOCKED

This file records the exact local implementation and the remaining review blockers. It is not a Production command, an AUTH-A receipt, or permission to reuse `auth-a-verified-session-001`. All new provider clients and the database aggregator are hard-disabled for Production until a separately reviewed orchestrator and a new human authorization exist.

## Mechanism inventory

DATABASE_MECHANISM=REAL_LOCAL_POSTGRES_PROVEN_PRODUCTION_DISABLED
CLOUDFLARE_MECHANISM=DOCUMENTED_SHAPE_LOCAL_MOCK_PROVEN_PRODUCTION_DISABLED
SUPABASE_MECHANISM=TWO_READ_INVENTORY_LOCAL_MOCK_PROVEN_PRODUCTION_DISABLED
BREVO_MECHANISM=MULTIPLAN_LOCAL_MOCK_PROVEN_PRODUCTION_DISABLED
SUPABASE_TWO_READS_SUFFICIENT_FOR_INVENTORY=true
SUPABASE_TWO_READS_SUFFICIENT_FOR_CAPACITY=false
MECHANISM_SCOPE_REVIEW_REQUIRED=true
SUPABASE_RESPONSE_CONTRACT=project.database.host
HISTORICAL_WORKER_MAPPING_FOUND=false
WORKER_IDENTITY_RULE_REVIEW_REQUIRED=true

AUTH_A_PACKET_SHA256=5dc9730dc5dcebc1a25b08abebea1f1cf0709cae79a593fcca7a81f9731c11b5
CATALOG_PACKET_SHA256=f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8
MIGRATION_HISTORY_PACKET_SHA256=6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002
FOUNDATION_SHA256=575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9
ENFORCEMENT_SHA256=89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e

| Class | Exact proposed read | Ceiling | Credential source class | Current local evidence |
| --- | --- | --- | --- | --- |
| PostgreSQL | One P9 transport process/session containing 11 catalog `SELECT` units from `docs/ops/verified-session-v1-hosted-catalog-preflight.sql`, then one migration-history `SELECT` from `docs/ops/p9-migration-history-rows-read-only.sql` | One connection attempt, one session, 12 frozen query units, zero retry | Existing `P9_PRODUCTION_DATABASE_URL`; never printed | `scripts/qa/verified-session-auth-a-db-capture.mjs` and real disposable local acceptance test. Production mode disabled. |
| Cloudflare | `GET /client/v4/accounts/{account_id}/workers/scripts/openglasshub/deployments`; then `GET /client/v4/accounts/{account_id}/workers/scripts/openglasshub/versions/{version_id}` where the ID comes from the first response | Two requests; no pagination, redirects or retry | Existing read-capable `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; values never printed | `scripts/qa/verified-session-auth-a-cloudflare-read.mjs` with loopback HTTP fixtures. Production mode disabled. |
| Supabase control plane | `GET /v1/projects`; then `GET /v1/organizations/{organization_slug}` derived from the unique target project | Two requests, no pagination, redirects or retry | Existing read-capable `SUPABASE_ACCESS_TOKEN`; value never printed | The project response exposes host as `database.host`, not `database_host`. Nested-host and old-alias-negative loopback fixtures pass. Inventory only; capacity remains `UNKNOWN`. Production mode disabled. |
| Brevo | `GET /v3/account`; then `GET /v3/senders` | Two requests, no redirects or retry | Existing server-side `BREVO_API_KEY` and expected sender email; values never printed | `scripts/qa/verified-session-auth-a-brevo-read.mjs` with loopback fixtures. Free email `sendLimit` plan, relay and active sender only; Production mode disabled. |

`scripts/qa/verified-session-auth-a-read-client.mjs` enforces local loopback, fixed GET path allowlists, an in-code pre-dispatch counter, manual redirect handling, exact HTTP 200, bounded JSON bodies, and generic error codes. It never exposes response JSON or request headers in shared output. Local tests use dummy token/sender values. Provider response shapes in these fixtures are candidates, not hosted observations; an unexpected real shape must be `UNKNOWN/BLOCKED`, not coerced to a match.

## Database contract and P9 regression finding

The aggregator verifies the two raw LF worktree byte hashes independently: catalog `f110454fe7ba5da07af0633e4be88119eeb24f21177d4be6ef302fd24268c0b8` and history `6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002`. It reuses `loadReadOnlyPacketUnits` to reject non-SELECT units, fixes `CATALOG_01` through `CATALOG_11` and `HISTORY_01`, combines the original bytes only in memory, and uses `runP9ReadOnlyCapture` without changing P9 transport or either SQL packet content. The P9 transcript supplies `BEGIN READ ONLY`, `transaction_read_only=on`, matching backend PID, `ON_ERROR_STOP`, explicit `ROLLBACK`, shell-free one-process execution, target allowlist and zero retry. The wrapper returns only whitelisted status/count/hash fields, not P9's raw per-query rows. `scripts/qa/test-verified-session-auth-a-db-local.mjs` proves the combined packet against disposable local Supabase/Postgres.

The five P9 failures were caused by CRLF checkout conversion of the P8 and history packets; the historical constants matched LF bytes exactly. `.gitattributes` now pins the genuinely byte-bound files to LF. No runtime normalization, dual-hash acceptance, P9 validator change, or SQL content change was made. The affected P9 suite passes 24/24 on raw checked-out bytes. The former history hash `1f4178d5...` is superseded; it must not be used for a future AUTH-A authorization.

### DB classifier source gap

`scripts/qa/verified-session-auth-a-db-capture.mjs` now has an internal-only result (`transportProof`, `queryResults`), while the shared wrapper returns only `transportProof`. `scripts/qa/verified-session-auth-a-execute.mjs` no longer accepts `steps.classify`; it consumes the database result through `scripts/qa/verified-session-auth-a-db-classify.mjs`. The three reviewed real-local stage digests were moved without alteration from the SQL replay test into `scripts/lib/verified-session-stage-digests.mjs`. No toy digest is used as release authority.

The 11 frozen AUTH-A catalog queries are **not** the 11 `finalCatalogSnapshot()` queries in `scripts/test-verified-session-sql.mjs`. The latter observes all 11 canonical families, including full `objects`, `readAcl`, and broad `rls` metadata; the former does not. Its P9 CSV representation also differs from the replay client's typed rows. An adapter cannot recover unobserved columns or produce an approved digest from these results. The internal classifier therefore returns `DB_STAGE=UNKNOWN`, `catalogPass=false`, `catalogDrift=INSUFFICIENT_PACKET_FOR_REVIEWED_DIGEST`; it never substitutes empty families or accepts a caller's claimed `PRE_V1`. The history parser does validate completed `HISTORY_01` fields, exact version-plus-name identities and duplicates/collisions, but absence alone cannot establish `CLEAN_UNSHIPPED_V1`. A separately reviewed, explicitly hash-rebound catalog packet and typed adapter are required before AUTH-A can classify a real DB stage.

## Cloudflare identity limit

The two paths match GET methods in the locally installed Cloudflare SDK bundled with Wrangler. Its version handling reads `result.metadata`, `result.resources.bindings`, `result.resources.script.etag`, and `result.resources.script_runtime` (not root-level fields). The local parser requires one 100% version and a matching version ID. The fixed path binds Worker name; the responses do not attest `environment`. Script ETag is a provider content hash, not a Git or local SHA-256. Repository release evidence contains no prior provider-observed deployment ID, version ID, ETag or reviewed old-build mapping. Therefore any future observation without independent mapping must set `DEPLOYED_WORKER_IDENTITY_MATCH=false` and `DEPLOYED_WORKER_IDENTITY_DRIFT=UNKNOWN`, blocking AUTH-A. No opaque Wrangler command or Worker invocation is used.

History search covered all Git refs via `git log --all -G` for the pinned old commit, deployment/version identifiers and ETag terms, plus current `docs/ops`, `docs/release`, and local release evidence. `docs/ops/verified-session-v1-hosted-readiness.md` records old source commit `e6c2141be8827d961fc49462d66be8da9b4993eb`; `wrangler.toml` and readiness docs record Worker name/origin. `docs/release/cloudflare-workers-provider-mutation-packet.md` specifies that future W4 receipts should record active version/source identity, but does not supply a prior observed UUID or script ETag. No reviewed old-build artifact-to-provider-ID mapping was found. The current identity criterion cannot be satisfied from recorded evidence alone; it is not relaxed here. `EXPECTED_OLD_WORKER_VERSION_ID` and `EXPECTED_OLD_WORKER_SCRIPT_ETAG` remain `NONE`.

## Supabase capacity semantic correction

`Free` plan identity, `ACTIVE_HEALTHY` project status and remaining quota are separate facts. The two fixed Management API reads can establish target project identity through the documented nested `project.database.host`, status and organization Free plan when their response fields are present and unambiguous. A flat `database_host` alias is explicitly rejected. They cannot prove remaining storage, Auth, Realtime or email capacity, so `FREE_CAPACITY_STATUS=UNKNOWN` and `CAPACITY_GATE=BLOCKED_BEFORE_AUTH_B`. No auth-config endpoint or token/session call is allowed. The corrected packet requires independent review and a new human authorization; it is not self-approved.

## Failure and execution boundary

- Methods: GET only for provider candidates; DB units are SELECT only. No POST/PUT/PATCH/DELETE, Worker smoke, Auth call, migration, mail, KV/R2 write or configuration change exists in these modules.
- Endpoints: only the fixed patterns above. A version path is derived from the sole deployment response. No pagination, redirected host, arbitrary URL or alternate provider command.
- Budgets: provider counters increment before dispatch and refuse the third request. The P9 transport is invoked once; no retry/reconnect code exists in the aggregator.
- Identity: exact project ref `xcbnxzjlsvtgzixurcof` and Worker `openglasshub`/Production must be proven from observed evidence before a future database session. Local fixtures do not prove hosted target or capacity.
- Output: shared evidence omits credential values, sender email, account PII, raw provider JSON, database URI, session ID, OTP and raw catalog rows. Local failure messages contain reason codes only.
- Production: hard-disabled in each new client. `scripts/qa/verified-session-auth-a-execute.mjs` is a non-executed LOCAL_TEST contract: it checks a new ID (never `auth-a-verified-session-001`), strict UTC, exact source/packet identity and `AUTH_A_EXECUTE=1`, orders the local mock steps, and fails closed without a reviewed Worker identity mapping. It rejects Production before any read. Its DB stage is derived only from the internal P9 result, currently UNKNOWN due to the packet gap; it is not a runnable hosted AUTH-A mechanism. Future Production clients must use constant HTTPS origins only; caller-injected origins are rejected.

Execution order remains source/hash/new-authorization validation, Cloudflare read, Supabase/Brevo read, target gate, one DB session, semantic catalog classification, migration provenance, capacity gate, redacted receipt, then stop. This order is a non-executable contract, not a runnable command.

## Local verification

Run `node --test scripts/qa/test-verified-session-auth-a-byte-bound-artifacts.mjs scripts/qa/test-verified-session-auth-a-db-capture.mjs scripts/qa/test-verified-session-auth-a-db-local.mjs scripts/qa/test-verified-session-auth-a-read-client.mjs scripts/qa/test-verified-session-auth-a-cloudflare-read.mjs scripts/qa/test-verified-session-auth-a-supabase-read.mjs scripts/qa/test-verified-session-auth-a-brevo-read.mjs scripts/qa/test-verified-session-auth-a-execute.mjs` and the affected existing P9 suites. The database acceptance uses a disposable local Supabase instance only. No mock fixture or unit test confers Production authorization. Supabase/Brevo response shapes have only user-supplied contract and local fixture proof in this offline task; independent schema and security review remain required before enabling hosted reads.

NEXT_ACTION=INDEPENDENT_SECURITY_REVIEW_OF_PACKET_AND_PARTIAL_MECHANISMS_THEN_NEW_SCOPE_DECISION
