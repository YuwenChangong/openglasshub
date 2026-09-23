# Release B Production PostgreSQL Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a reviewed QA/operator-only native PostgreSQL adapter that supplies `createSession` and `readPostcheck` to the existing Release B Production transport without changing Release B business semantics.

**Architecture:** Keep Option A from the approved spec: `release-b-production-runner.mjs` composes a new `scripts/qa/lib/release-b-production-postgres-adapter.mjs`, then passes its collaborators into the existing `createReleaseBProductionTransport()`, then the existing executor owns authorization, ledger consumption, immutable plan rebuild, transaction invocation, and postconditions. The adapter owns only native driver session lifecycle and fixed read-only postcheck query composition.

**Tech Stack:** Node ESM, `node:assert/strict`, existing QA scripts, npm lockfile v3, `pg` as a QA/operator-only `devDependency`, existing local disposable PostgreSQL/Supabase replay harness.

**Spec:** `docs/superpowers/specs/2026-09-21-release-b-production-postgres-adapter-design.md`

## Global Constraints

- Production connections during implementation = 0.
- Production writes during implementation = 0.
- Release B executions during implementation = 0.
- `qa:prod` is forbidden.
- Deploy, merge, and Cloudflare actions are forbidden.
- `maxAttempts=1`.
- `automaticRetry=false`.
- Session Pooler only for adapter execution.
- No TLS downgrade; Production TLS must fail closed if secure driver configuration cannot be established.
- No unreviewed `rejectUnauthorized: false`.
- No hidden reconnect.
- No automatic retry.
- No DELETE.
- No DDL.
- No migration history mutation.
- No manual SQL.
- No alternate SQL client.
- No `psql` Production execution path.
- No Supabase REST/RPC Production execution path.
- P9 read-only transport remains read-only and untouched.
- `pg` remains QA/operator-only and must not enter the deployed Astro/Cloudflare runtime.
- V4 authorization binds the Production PostgreSQL adapter fingerprint.
- Approval-3 is historical/non-executable after adapter code changes.
- Transport remains transaction owner.
- Executor remains authorization, ledger, immutable plan, expected-postcondition, and ambiguity owner.
- Fingerprints that depend on final source bytes are computed late from final source bytes, never hardcoded early.
- Use `git add <explicit paths>` only; never use `git add .`.

## Review Focus

1. Secure TLS configuration incompatibility must fail closed, not silently disable certificate or hostname verification. Covered by Task 1 unit tests and Task 3 integration/config evidence.
2. Expected `safeTarget` metadata must not be mistaken for database-observed target identity. Covered by Task 1 adapter contract tests and Task 4 runner/transport composition tests.
3. `identifyTarget`, transaction, and postcheck connection failures must preserve distinct ledger state. Covered by Task 6 failure/ambiguity tests.
4. Commit acknowledgement loss must remain `RELEASE_B_EXECUTION_AMBIGUOUS` and must never become retryable. Covered by Task 6 ambiguity tests and Task 7 rehearsal retry checks.
5. `pg` must never leak into deployed Astro/Cloudflare runtime. Covered by Task 8 runtime isolation and build-safety checks.

---

## File Structure

- `scripts/qa/lib/release-b-production-postgres-adapter.mjs`: new adapter module. Exports `createReleaseBProductionPostgresAdapter({ environment, Client })`. Produces `{ createSession, readPostcheck }`.
- `scripts/qa/test-release-b-production-postgres-adapter.mjs`: new unit/contract tests for adapter construction, TLS config, Session Pooler enforcement, secret safety, query passthrough, close lifecycle, no retry, and postcheck shape.
- `scripts/qa/test-release-b-production-postgres-adapter-local.mjs`: new disposable PostgreSQL integration test using the existing local replay infrastructure when possible.
- `scripts/qa/release-b-production-runner.mjs`: later modified to compose the adapter only after local v4 authorization/fingerprint checks.
- `scripts/qa/release-b-production-import.mjs`: later modified to add v4 schema constants, strict key list, adapter fingerprint binding, and v3 historical rejection for adapter-bound execution.
- Existing tests updated in focused tasks: `scripts/qa/test-release-b-production-runner.mjs`, `scripts/qa/test-release-b-production-transport.mjs`, `scripts/qa/test-device-schema-v1-transaction-contract.mjs`, and historical receipt tests.
- `docs/ops/device-schema-v1-release-b-transaction-runbook.md`: updated only after implementation behavior is final.
- `package.json` and `package-lock.json`: modified only in Task 1 to add `pg` as a devDependency and lock it through npm conventions.

## Task Dependencies

Task 1 creates the adapter interface. Task 2 depends on Task 1. Task 3 depends on Tasks 1-2. Task 4 depends on Tasks 1-2. Task 5 depends on Task 4 because v4 binds the stable adapter/runner execution surface. Task 6 depends on Task 5 for ledger/authorization behavior. Task 7 depends on Tasks 1-6. Task 8 can begin after Task 1 but final proof must run after all code changes. Task 9 is last.

### Task 1: PG Driver And Adapter Unit Contract

**Files:**
- Create: `scripts/qa/lib/release-b-production-postgres-adapter.mjs`
- Create: `scripts/qa/test-release-b-production-postgres-adapter.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `scripts/qa/test-release-b-production-postgres-adapter.mjs`

**Interfaces:**
- Consumes: `parseP9Connection({ mode: "PRODUCTION", dsn })` from `scripts/qa/p9-readonly-postgres-transport.mjs`; adapter spec from `docs/superpowers/specs/2026-09-21-release-b-production-postgres-adapter-design.md`.
- Produces: `createReleaseBProductionPostgresAdapter({ environment = process.env, Client })` returning frozen `{ createSession, readPostcheck }`; `createSession({ pgEnv, safeTarget })` returning `{ targetIdentity, query(sql, params), close() }`.

- [ ] **Step 1: Verify package convention and install plan**

Run: `node -e "const p=require('./package-lock.json'); const root=p.packages['']; console.log(JSON.stringify({lockfileVersion:p.lockfileVersion, hasPg:Boolean((root.dependencies&&root.dependencies.pg)||(root.devDependencies&&root.devDependencies.pg)), devDependencies:Object.keys(root.devDependencies||{}).sort()}))"`

Expected: prints lockfile version `3`, `hasPg:false`, and existing devDependency names.

- [ ] **Step 2: Add the driver as QA/operator-only dependency**

Run: `npm install --save-dev pg`

Expected: `package.json` gains `devDependencies.pg`; `package-lock.json` updates only npm lock data for `pg` and its transitive dependencies. Do not run `npm audit fix`. Do not upgrade unrelated dependencies.

- [ ] **Step 3: Write failing adapter import and construction tests**

Add `scripts/qa/test-release-b-production-postgres-adapter.mjs` with tests named:

```js
assert.equal(typeof createReleaseBProductionPostgresAdapter, "function");
assert.equal(clientConstructed, 0, "adapter construction must not construct Client");
assert.equal(connectCalls, 0, "adapter construction must not connect");
```

The import should target `./lib/release-b-production-postgres-adapter.mjs`.

- [ ] **Step 4: Run RED for missing adapter module**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected RED: `ERR_MODULE_NOT_FOUND` or equivalent missing export failure for `release-b-production-postgres-adapter.mjs`.

- [ ] **Step 5: Implement minimal module export**

Create `scripts/qa/lib/release-b-production-postgres-adapter.mjs` exporting `createReleaseBProductionPostgresAdapter`. The first implementation should return frozen no-op-shaped collaborators only far enough to satisfy import/construction tests and still fail later contract tests.

- [ ] **Step 6: Add failing createSession contract tests**

Extend the test with fake `Client` classes for:

```js
const SESSION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const DIRECT_DSN = "postgresql://postgres:test-only@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require";
const TRANSACTION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require";
```

Assert missing env and `TRANSACTION_DSN` fail before Client construction; `DIRECT_DSN` fails adapter Session Pooler enforcement before Client construction; `SESSION_DSN` constructs one Client only inside `createSession`; `query("SELECT $1::int AS value", [7])` passes SQL and params through; `close()` calls `client.end()` once; second close is harmless or fails closed without reconnect; connect/query/end failure counters stay at one.

- [ ] **Step 7: Add failing TLS tests**

Add fake Client constructor capture tests that reject any Production config without an explicit TLS object, and assert the adapter never sets unreviewed `ssl.rejectUnauthorized === false`. Include a test named `adapter TLS config fails closed on unsupported downgrade`.

Expected RED before implementation: Client receives no reviewed TLS config or adapter lacks downgrade guard.

- [ ] **Step 8: Verify official TLS configuration before finalizing code**

Read official `pg` / node-postgres SSL documentation and Supabase's current Postgres connection TLS guidance. Record the exact evidence as a short comment in the test or a short note in the task commit message. If documentation requires a CA bundle for hostname/certificate verification, implement CA-loading only from an explicit reviewed file path and fail closed when absent; do not use `rejectUnauthorized:false`.

- [ ] **Step 9: Implement minimal adapter session lifecycle**

Implement:

```js
export function createReleaseBProductionPostgresAdapter({ environment = process.env, Client = PgClient } = {}) { ... }
```

Use existing `parseP9Connection` for env parsing. Enforce `safeTarget.endpointClass === "SUPAVISOR_SESSION"`. Build Client options from `pgEnv` only. Preserve `targetIdentity` as expected/config-derived metadata from `safeTarget`. Implement no retry, no reconnect, no logging, and no secret-bearing thrown messages from adapter-controlled failures.

- [ ] **Step 10: Run focused GREEN tests**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: PASS with a terminal line such as `RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_UNIT_OK`.

- [ ] **Step 11: Run regression tests**

Run: `node scripts/qa/test-release-b-production-transport.mjs`

Expected: `RELEASE_B_PRODUCTION_TRANSPORT_UNIT_OK`.

- [ ] **Step 12: Review diff**

Run: `git diff -- package.json package-lock.json scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: only driver dependency and adapter/test files changed; no runner/importer behavior changed in this task.

- [ ] **Step 13: Commit explicit files**

Run:

```bash
git add package.json package-lock.json scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs
git commit -m "feat: add Release B production postgres adapter contract"
```

### Task 2: Real readPostcheck Contract

**Files:**
- Create: none
- Modify: `scripts/qa/lib/release-b-production-postgres-adapter.mjs`
- Modify: `scripts/qa/test-release-b-production-postgres-adapter.mjs`
- Test: `scripts/qa/test-release-b-production-postgres-adapter.mjs`

**Interfaces:**
- Consumes: adapter return value from Task 1; transport-supplied `queryReadOnly(sql, params)`.
- Produces: `readPostcheck({ queryReadOnly })` returning `{ counts, uniqueSlugs, publishedDevices, conflictInvariants, rayBanIdentity, unexpectedDeletes }`.

- [ ] **Step 1: Write failing readPostcheck tests**

In `scripts/qa/test-release-b-production-postgres-adapter.mjs`, add a fake `queryReadOnly` that records SQL and returns rows for the exact observed fields:

```js
{
  devices: 24,
  device_spec_definitions: 92,
  device_specs: 1488,
  device_sources: 39,
  device_source_links: 46,
  device_spec_evidence: 15,
  catalog_audit_events: 0,
  unique_slugs: 24,
  published_devices: 24,
  constraint_failures: 0,
  trigger_failures: 0,
  duplicate_failures: 0,
  conflict_evidence_failures: 0,
  unknown_unverified_known_data: 0,
  ray_ban_identity: "ray-ban-meta",
  unexpected_deletes: 0
}
```

Assert output keys are camelCase exactly as executor `assertPostcheck()` consumes them. Assert `readPostcheck` does not compare to expected counts by returning one deliberately wrong count and confirming it is passed through as observed data.

- [ ] **Step 2: Verify RED**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected RED: assertion that `readPostcheck` is missing, returns incomplete shape, or does not issue the fixed query.

- [ ] **Step 3: Implement fixed read-only query**

Add a fixed `WITH`/`SELECT` query inside the adapter, using only `queryReadOnly`. Query facts must come from existing schema/test helpers:

- `public.devices`
- `public.device_spec_definitions`
- `public.device_specs`
- `public.device_sources`
- `public.device_source_links`
- `public.device_spec_evidence`
- `public.catalog_audit_events`
- conflict/trigger/duplicate predicates from `readSchemaV1SqlVerification()` in `scripts/devices/schema-v1/disposable-postgres-transaction-client.mjs`
- Ray-Ban slug lookup from `public.devices`

Do not copy expected Release B counts into adapter policy.

- [ ] **Step 4: Add mutation guard regression**

Add a test where fake `queryReadOnly` throws if SQL does not start with `SELECT` or `WITH`, and assert no `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, or `supabase_migrations` mutation appears in the postcheck query.

- [ ] **Step 5: Run focused GREEN**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: PASS.

- [ ] **Step 6: Run transport read-only regression**

Run: `node scripts/qa/test-release-b-production-transport.mjs`

Expected: unsafe postcheck still rejects with `RELEASE_B_PRODUCTION_READ_ONLY_VIOLATION`.

- [ ] **Step 7: Review diff**

Run: `git diff -- scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: adapter owns fixed read-only query composition only; no expected-count policy and no mutation SQL.

- [ ] **Step 8: Commit explicit files**

Run:

```bash
git add scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs
git commit -m "feat: add Release B postgres postcheck collaborator"
```

### Task 3: Disposable Real PostgreSQL Integration

**Files:**
- Create: `scripts/qa/test-release-b-production-postgres-adapter-local.mjs`
- Modify: `scripts/qa/lib/release-b-production-postgres-adapter.mjs` only if integration exposes a driver lifecycle bug
- Test: `scripts/qa/test-release-b-production-postgres-adapter-local.mjs`

**Interfaces:**
- Consumes: `createReleaseBProductionPostgresAdapter()` from Task 1 and `runLocalDisposableReplay({ afterMigrationLedgerValidated })` from `scripts/qa/local-disposable-supabase-replay.mjs`.
- Produces: local-only evidence that the adapter's native driver path works with real PostgreSQL behavior.

- [ ] **Step 1: Write failing local integration test**

Create `scripts/qa/test-release-b-production-postgres-adapter-local.mjs`. Use `runLocalDisposableReplay({ afterMigrationLedgerValidated })` and its owned local database context. If the harness exposes a TCP/local DSN, use it. If it only exposes `createSqlSession`, add a small local-only helper in this test that derives a loopback connection from the disposable environment only after proving no remote host is used.

Tests must assert:

- connect succeeds
- parameterized query returns a value
- `BEGIN` / write / `COMMIT` persists in a scratch local table
- `BEGIN` / write / `ROLLBACK` does not persist
- transaction error rolls back
- fresh session reads committed state
- `close()` closes the session
- no retry counters exceed one

- [ ] **Step 2: Run RED**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-local.mjs`

Expected RED: missing local adapter integration support, missing `pg`, or lifecycle behavior not implemented.

- [ ] **Step 3: Implement minimal local-test support**

If adapter needs a `mode: "LOCAL_TEST"` test hook, keep it private to tests through injected `Client` or explicit local options. Do not widen Production target acceptance. Do not modify `scripts/qa/p9-readonly-postgres-transport.mjs`.

- [ ] **Step 4: Add synthetic commit-ack boundary note**

In this test file, separate real database lifecycle tests from synthetic commit-ack ambiguity tests. Assert the file does not claim network-level COMMIT ambiguity unless it actually severs a local connection deterministically at commit acknowledgement.

- [ ] **Step 5: Run focused GREEN**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-local.mjs`

Expected: PASS with a terminal line such as `RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_LOCAL_OK`.

- [ ] **Step 6: Run adapter unit regression**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: PASS.

- [ ] **Step 7: Review diff**

Run: `git diff -- scripts/qa/test-release-b-production-postgres-adapter-local.mjs scripts/qa/lib/release-b-production-postgres-adapter.mjs`

Expected: local-only integration proof; no Production host, credential, DNS, or socket.

- [ ] **Step 8: Commit explicit files**

Run:

```bash
git add scripts/qa/test-release-b-production-postgres-adapter-local.mjs scripts/qa/lib/release-b-production-postgres-adapter.mjs
git commit -m "test: prove Release B postgres adapter locally"
```

### Task 4: Runner Composition

**Files:**
- Create: none
- Modify: `scripts/qa/release-b-production-runner.mjs`
- Modify: `scripts/qa/test-release-b-production-runner.mjs`
- Test: `scripts/qa/test-release-b-production-runner.mjs`

**Interfaces:**
- Consumes: `createReleaseBProductionPostgresAdapter({ environment })` from Task 1; existing `runReleaseBProductionRunner()` API.
- Produces: CLI execution path that supplies reviewed adapter collaborators after authorization/fingerprint checks and before executor invocation.

- [ ] **Step 1: Write RED reproducing previous bug**

Extend `scripts/qa/test-release-b-production-runner.mjs` to simulate CLI execution or `runReleaseBProductionRunner()` without manual collaborator injection. Assert the old path fails with `RELEASE_B_PRODUCTION_TRANSPORT_INCOMPLETE` because `createSession` and `readPostcheck` are absent.

Run: `node scripts/qa/test-release-b-production-runner.mjs`

Expected RED: the new expectation fails because the current runner still lacks adapter composition.

- [ ] **Step 2: Add composition tests**

Add fake adapter injection support or mockable import seam only if necessary for tests. Prove:

- module import opens zero sessions
- preflight opens zero sessions and consumes zero authorization
- construction opens zero sessions
- explicit `--execute-production` is required
- execution path calls the reviewed adapter exactly after local authorization/fingerprint checks
- placeholders from preflight cannot reach actual execution
- runner still exposes no alternate SQL client path

- [ ] **Step 3: Implement minimal runner composition**

Import the adapter module and call `createReleaseBProductionPostgresAdapter({ environment })` only in the execution path. Pass returned `createSession` and `readPostcheck` into `createReleaseBProductionRunnerTransport()`. Preserve preflight structural behavior.

- [ ] **Step 4: Run focused GREEN**

Run: `node scripts/qa/test-release-b-production-runner.mjs`

Expected: `RELEASE_B_PRODUCTION_RUNNER_CONTRACT_OK`.

- [ ] **Step 5: Run adapter and transport regressions**

Run:

```bash
node scripts/qa/test-release-b-production-postgres-adapter.mjs
node scripts/qa/test-release-b-production-transport.mjs
```

Expected: both PASS.

- [ ] **Step 6: Review diff**

Run: `git diff -- scripts/qa/release-b-production-runner.mjs scripts/qa/test-release-b-production-runner.mjs`

Expected: runner composition only; no executor, transport, or package changes.

- [ ] **Step 7: Commit explicit files**

Run:

```bash
git add scripts/qa/release-b-production-runner.mjs scripts/qa/test-release-b-production-runner.mjs
git commit -m "feat: compose Release B postgres adapter in runner"
```

### Task 5: Authorization V4

**Files:**
- Create: `scripts/qa/test-release-b-authorization-receipt-v4.mjs`
- Modify: `scripts/qa/release-b-production-import.mjs`
- Modify: `scripts/qa/test-release-b-production-runner.mjs`
- Modify: `scripts/qa/test-device-schema-v1-transaction-contract.mjs`
- Test: `scripts/qa/test-release-b-authorization-receipt-v4.mjs`

**Interfaces:**
- Consumes: final source bytes for runner, transport, executor, and adapter; existing `hashAuthorizationReceipt()`, `loadTask17FrozenGate()`, and v1/v2/v3 validation patterns.
- Produces: `AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4`, v4 strict key validation, v4 receipt builder for synthetic tests, adapter fingerprint in execution-surface binding, and v1/v2/v3 rejection for adapter-bound execution.

- [ ] **Step 1: Write RED v4 receipt tests**

Create `scripts/qa/test-release-b-authorization-receipt-v4.mjs` asserting imports exist:

```js
AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4
createReleaseBAuthorizationReceiptV4
validateCurrentReleaseBAuthorizationReceiptV4
```

Also assert `computeReleaseBExecutionSurfaceFingerprints()` returns `productionPostgresAdapterFingerprint`.

Run: `node scripts/qa/test-release-b-authorization-receipt-v4.mjs`

Expected RED: missing exports and missing adapter fingerprint.

- [ ] **Step 2: Implement v4 schema constants and strict keys**

In `scripts/qa/release-b-production-import.mjs`, add v4 schema and strict key list extending v3 with adapter path/fingerprint fields. Keep v1/v2/v3 validators available for historical tests.

- [ ] **Step 3: Add v4 fingerprint computation**

Extend `computeReleaseBExecutionSurfaceFingerprints()` with optional `adapterCommit` / `adapterBytes` and return `productionPostgresAdapterFingerprint`. Compute from final source bytes late. Do not hardcode the hash in tests except as a derived test value.

- [ ] **Step 4: Add v4 builder and validator**

Implement `createReleaseBAuthorizationReceiptV4()` and `validateCurrentReleaseBAuthorizationReceiptV4()` mirroring existing canonical hashing and strict field behavior. Reject missing adapter fingerprint, mismatched adapter fingerprint, unknown fields, wrong target, wrong code identity, `maxAttempts` mutation, and `automaticRetry` mutation.

- [ ] **Step 5: Update runner and executor validation to require v4**

Change adapter-bound execution path to reject v1/v2/v3 before transport construction. Approval-3 must be historical/non-executable after this task.

- [ ] **Step 6: Run focused GREEN**

Run:

```bash
node scripts/qa/test-release-b-authorization-receipt-v4.mjs
node scripts/qa/test-release-b-production-runner.mjs
node scripts/qa/test-device-schema-v1-transaction-contract.mjs
```

Expected: all PASS; v3 historical rejection is explicit.

- [ ] **Step 7: Run historical receipt regression**

Run: `node scripts/qa/test-release-b-authorization-receipt-v2.mjs`

Expected: historical v1/v2 validation still passes where intended and remains non-executable.

- [ ] **Step 8: Review diff**

Run: `git diff -- scripts/qa/release-b-production-import.mjs scripts/qa/test-release-b-authorization-receipt-v4.mjs scripts/qa/test-release-b-production-runner.mjs scripts/qa/test-device-schema-v1-transaction-contract.mjs`

Expected: v4 authorization only; no receipt artifact generation and no Production connection.

- [ ] **Step 9: Commit explicit files**

Run:

```bash
git add scripts/qa/release-b-production-import.mjs scripts/qa/test-release-b-authorization-receipt-v4.mjs scripts/qa/test-release-b-production-runner.mjs scripts/qa/test-device-schema-v1-transaction-contract.mjs
git commit -m "feat: bind Release B postgres adapter authorization v4"
```

### Task 6: Failure And Ambiguity Contract

**Files:**
- Create: none
- Modify: `scripts/qa/test-device-schema-v1-transaction-contract.mjs`
- Modify: `scripts/qa/test-release-b-production-transport.mjs`
- Modify: `scripts/qa/test-release-b-production-postgres-adapter.mjs`
- Modify: implementation files only if tests expose contract gaps
- Test: listed test files

**Interfaces:**
- Consumes: v4 validation from Task 5; adapter/transport/executor chain from Tasks 1-5.
- Produces: explicit regression coverage for identify-target, transaction-session, and postcheck-session connection/authentication failures and ledger state.

- [ ] **Step 1: Write failing identify-target phase tests**

In `scripts/qa/test-device-schema-v1-transaction-contract.mjs`, add cases where `transport.identifyTarget()` throws deterministic connect failure, auth failure, and target mismatch. Assert transaction count is `0`, canonical/sandbox ledger entry is absent, and retry is not attempted.

Run: `node scripts/qa/test-device-schema-v1-transaction-contract.mjs`

Expected RED: missing explicit ledger-state assertions for identify-target failures.

- [ ] **Step 2: Write failing transaction-session phase tests**

Add cases for before-BEGIN connection failure, transaction auth failure, precheck drift, deterministic write failure, connection loss after first write, rollback failure, and commit acknowledgement loss. Assert durable `STARTED` ledger exists after each case, no retry occurs, and ambiguous outcomes surface `RELEASE_B_EXECUTION_AMBIGUOUS` where the executor ambiguity predicate applies.

- [ ] **Step 3: Write failing postcheck-session phase tests**

Add cases for postcheck deterministic mismatch and postcheck connection/provider loss. Assert ledger remains consumed, no retry occurs, deterministic mismatch is `RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED`, and transport/provider loss is `RELEASE_B_EXECUTION_AMBIGUOUS`.

- [ ] **Step 4: Implement minimal fixes**

Adjust adapter error preservation or runner/executor mapping only where tests prove a gap. Do not add retries. Do not delete or reset ledger entries.

- [ ] **Step 5: Run focused GREEN**

Run:

```bash
node scripts/qa/test-device-schema-v1-transaction-contract.mjs
node scripts/qa/test-release-b-production-transport.mjs
node scripts/qa/test-release-b-production-postgres-adapter.mjs
```

Expected: all PASS, including explicit no-retry counters.

- [ ] **Step 6: Review diff**

Run: `git diff -- scripts/qa/test-device-schema-v1-transaction-contract.mjs scripts/qa/test-release-b-production-transport.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/release-b-production-import.mjs`

Expected: failure semantics coverage/fixes only; no retry framework.

- [ ] **Step 7: Commit explicit files**

Run:

```bash
git add scripts/qa/test-device-schema-v1-transaction-contract.mjs scripts/qa/test-release-b-production-transport.mjs scripts/qa/test-release-b-production-postgres-adapter.mjs scripts/qa/lib/release-b-production-postgres-adapter.mjs scripts/qa/release-b-production-import.mjs
git commit -m "test: harden Release B adapter failure semantics"
```

### Task 7: Full Disposable Release B Rehearsal

**Files:**
- Create: `scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`
- Modify: `scripts/qa/test-release-b-production-disposable-rehearsal.mjs` only if shared helper extraction is needed
- Test: `scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`

**Interfaces:**
- Consumes: adapter, runner composition, v4 synthetic authorization, existing local disposable replay harness, existing Release B normalized payload.
- Produces: full local-only proof for `runner -> adapter -> transport -> executor`.

- [ ] **Step 1: Write failing full-chain rehearsal**

Create `scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`. Use `runLocalDisposableReplay({ afterMigrationLedgerValidated })`, `createReleaseBTestFixture()`, synthetic v4 receipt helper, and the real runner/adapter/transport/executor chain. The test must assert exact committed state:

```js
[devices, definitions, specs, sources, sourceLinks, evidence, auditEvents, uniqueSlugs, published]
=== [24, 92, 1488, 39, 46, 15, 0, 24, 24]
```

Also assert `conflictInvariants === "PASS"`, `rayBanIdentity === "ray-ban-meta"`, `unexpectedDeletes === 0`, consumed synthetic authorization rejects retry, and no Production source is used.

- [ ] **Step 2: Run RED**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`

Expected RED: runner/adapter/v4 full-chain behavior not yet wired for disposable rehearsal or synthetic v4 helper missing.

- [ ] **Step 3: Implement minimal local rehearsal support**

Use existing disposable infrastructure. Do not add Production credentials. Do not call `qa:prod`. Keep all data local to disposable PostgreSQL.

- [ ] **Step 4: Add rollback/atomicity rehearsal**

Add a local CHECK constraint failure or precheck drift case proving zero partial committed application rows after failure, matching the existing disposable rehearsal style.

- [ ] **Step 5: Run focused GREEN**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`

Expected: PASS with a terminal line such as `RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_REHEARSAL_OK`.

- [ ] **Step 6: Run existing disposable regression**

Run: `node scripts/qa/test-release-b-production-disposable-rehearsal.mjs`

Expected: `RELEASE_B_PRODUCTION_DISPOSABLE_REHEARSAL_OK`.

- [ ] **Step 7: Review diff**

Run: `git diff -- scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs scripts/qa/test-release-b-production-disposable-rehearsal.mjs`

Expected: local-only rehearsal and optional shared test helper changes; no Production execution.

- [ ] **Step 8: Commit explicit files**

Run:

```bash
git add scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs scripts/qa/test-release-b-production-disposable-rehearsal.mjs
git commit -m "test: rehearse Release B postgres adapter locally"
```

### Task 8: Runtime Isolation And Build Safety

**Files:**
- Create: `scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs`
- Modify: `scripts/qa/profiles/release.mjs` only if the release matrix should include new adapter local tests
- Modify: `package.json` only if adding test scripts is justified by existing conventions
- Test: runtime isolation test, build, release profile

**Interfaces:**
- Consumes: `pg` devDependency and adapter file from prior tasks.
- Produces: evidence that `pg` remains QA/operator-only and is absent from deployed Astro/Cloudflare runtime imports.

- [ ] **Step 1: Write failing runtime isolation test**

Create `scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs` to scan runtime source directories such as `src`, `astro.config.*`, `wrangler.toml`, and build output manifest inputs for forbidden imports:

```js
/(from\s+["']pg["']|require\(["']pg["']\)|release-b-production-postgres-adapter)/
```

Allow matches only under `scripts/qa`.

- [ ] **Step 2: Run RED**

Run: `node scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs`

Expected RED until test file exists; after creation, it should pass unless runtime imports leaked.

- [ ] **Step 3: Add release profile coverage if appropriate**

If database-area changes already trigger `qa:release`, add the new non-Production adapter tests to `scripts/qa/profiles/release.mjs` as local command checks. Do not add `qa:prod`.

- [ ] **Step 4: Run build safety checks**

Run:

```bash
node scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs
npm run build
```

Expected: runtime isolation PASS and normal build PASS without bundling or requiring `pg` in deployed runtime.

- [ ] **Step 5: Run dependency checks**

Run:

```bash
npm audit --omit=optional
node -e "const p=require('./package-lock.json'); const root=p.packages['']; if (!root.devDependencies.pg || root.dependencies.pg) throw new Error('PG_SCOPE_INVALID'); console.log('PG_SCOPE_DEV_DEPENDENCY')"
```

Expected: audit output reviewed without running `npm audit fix`; scope check prints `PG_SCOPE_DEV_DEPENDENCY`.

- [ ] **Step 6: Review diff**

Run: `git diff -- scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs scripts/qa/profiles/release.mjs package.json package-lock.json`

Expected: runtime isolation test and optional QA release registration only.

- [ ] **Step 7: Commit explicit files**

Run:

```bash
git add scripts/qa/test-release-b-postgres-adapter-runtime-isolation.mjs scripts/qa/profiles/release.mjs package.json package-lock.json
git commit -m "test: keep Release B postgres adapter out of runtime"
```

### Task 9: Runbook And Final Safety Verification

**Files:**
- Create: none
- Modify: `docs/ops/device-schema-v1-release-b-transaction-runbook.md`
- Test: full local verification matrix listed below

**Interfaces:**
- Consumes: completed adapter, runner composition, v4 authorization support, local tests, release profile.
- Produces: final operator documentation for the reviewed future path, with no Production execution.

- [ ] **Step 1: Write runbook update**

Update `docs/ops/device-schema-v1-release-b-transaction-runbook.md` to document:

- Session Pooler only
- environment-only `P9_PRODUCTION_DATABASE_URL`
- v4 authorization required
- adapter fingerprint required
- structural preflight remains no connection / no SQL / no ledger
- exact future execution command
- one-shot execution
- `maxAttempts=1`
- `automaticRetry=false`
- ambiguity means stop/no retry
- credential cleanup
- approval-3 historical only

- [ ] **Step 2: Run adapter unit tests**

Run: `node scripts/qa/test-release-b-production-postgres-adapter.mjs`

Expected: PASS.

- [ ] **Step 3: Run adapter/transport contract tests**

Run: `node scripts/qa/test-release-b-production-transport.mjs`

Expected: PASS.

- [ ] **Step 4: Run runner tests**

Run: `node scripts/qa/test-release-b-production-runner.mjs`

Expected: PASS.

- [ ] **Step 5: Run authorization v4 tests**

Run: `node scripts/qa/test-release-b-authorization-receipt-v4.mjs`

Expected: PASS.

- [ ] **Step 6: Run transaction/ambiguity tests**

Run: `node scripts/qa/test-device-schema-v1-transaction-contract.mjs`

Expected: PASS.

- [ ] **Step 7: Run disposable PostgreSQL integration tests**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-local.mjs`

Expected: PASS.

- [ ] **Step 8: Run full disposable Release B rehearsal**

Run: `node scripts/qa/test-release-b-production-postgres-adapter-rehearsal.mjs`

Expected: PASS.

- [ ] **Step 9: Run historical receipt tests**

Run:

```bash
node scripts/qa/test-release-b-authorization-receipt-v2.mjs
node scripts/qa/generate-release-b-authorization-receipt.mjs --historical-v2-validation-only
```

Expected: historical validation remains historical; no current execution receipt is created for Production.

- [ ] **Step 10: Run importer tests**

Run: `node scripts/qa/test-device-schema-v1-transaction-contract.mjs`

Expected: PASS and no canonical Production ledger mutation.

- [ ] **Step 11: Run project and build checks**

Run:

```bash
npm test
npm run build
npm run qa:release
```

Expected: all PASS. Do not run `npm run qa:prod`.

- [ ] **Step 12: Run formatting and status checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status shows only intended files before commit, then clean after commit.

- [ ] **Step 13: Run secret scan of changed files**

Run:

```bash
git diff --name-only HEAD~8..HEAD | % { if (Test-Path $_) { Select-String -Path $_ -Pattern "postgres(?:ql)?://|PGPASSWORD|password=|sbp_|eyJ|-----BEGIN" -CaseSensitive:$false } }
```

Expected: no real credentials or secret-shaped values. Test-only synthetic DSNs must use obvious dummy passwords and never real hosts beyond reviewed placeholder target shapes.

- [ ] **Step 14: Review final diff and commit runbook**

Run: `git diff -- docs/ops/device-schema-v1-release-b-transaction-runbook.md`

Expected: documentation only. Then:

```bash
git add docs/ops/device-schema-v1-release-b-transaction-runbook.md
git commit -m "docs: update Release B postgres adapter runbook"
```

- [ ] **Step 15: Whole-branch review gate**

Request one final whole-branch review before any Production authorization or execution. Review must check: no second importer, no duplicate transaction owner, no generalized DB abstraction, no Production testing, no hidden retry, TLS hardening, three connection stages, target identity semantics, runtime isolation, v4 adapter binding, and ambiguous commit behavior.
