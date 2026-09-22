# Release B Production PostgreSQL Adapter Design

## Status

Approved architecture / design specification.

This document is design-only. It does not authorize Production access, create a
receipt, consume a ledger entry, or implement the adapter.

## Context

Release B has a reviewed executor and a reviewed Production transport contract,
but the command-line runner cannot execute because no reviewed real Production
PostgreSQL collaborators exist for the transport's `createSession` and
`readPostcheck` injection points.

The approved architecture is Option A: add a dedicated reviewed Production
PostgreSQL adapter at `scripts/qa/lib/release-b-production-postgres-adapter.mjs`.
The adapter bridges the existing `P9_PRODUCTION_DATABASE_URL` connection source
to the existing Release B transport contract. It must not become a second
importer, a second transaction coordinator, a replacement for the P9 read-only
transport, or a manual SQL path.

## Proven Current Failure

The current runner in `scripts/qa/release-b-production-runner.mjs` validates
authorization and then calls `createReleaseBProductionRunnerTransport({
environment, createSession, readPostcheck })`. The CLI `main()` path loads the
receipt and calls `runReleaseBProductionRunner()` without passing either
collaborator, so the Production transport fails closed with
`RELEASE_B_PRODUCTION_TRANSPORT_INCOMPLETE`.

`scripts/qa/release-b-production-import.mjs` still deliberately has no CLI
adapter and its own `main()` fails `--execute-production` with
`RELEASE_B_TRANSPORT_INJECTION_REQUIRED`. That file establishes that a future
reviewed transport must be supplied through a reviewed programmatic boundary.

Repository search found only synthetic, fake, or disposable local
`createSession` / `readPostcheck` implementations in tests. The P9 transport in
`scripts/qa/p9-readonly-postgres-transport.mjs` is read-only `psql` packet
capture and must remain read-only.

## Goals

- Add one narrow Production PostgreSQL adapter module in a future
  implementation.
- Reuse the existing P9 connection parser and target validation.
- Expose the exact collaborator functions expected by
  `createReleaseBProductionTransport()`: `createSession` and `readPostcheck`.
- Preserve existing authorization, immutable payload, ledger, retry, transaction,
  ambiguity, SQL-scope, and postcheck semantics.
- Keep all tests and rehearsals offline or disposable until a future reviewed v4
  authorization is created.
- Make the eventual implementation testable by unit tests, contract tests,
  disposable PostgreSQL integration tests, and a full disposable Release B
  rehearsal.

## Non-Goals

- No Release B business logic in the adapter.
- No expected-count constants or payload interpretation in the adapter.
- No ledger creation, ledger mutation, or authorization validation in the
  adapter.
- No retry loop, reconnect loop, backoff, pool manager, ORM, migration runner,
  Supabase REST/RPC transport, Supabase MCP/tool execution, `psql` execution
  path, `qa:prod`, deploy, merge, or Cloudflare operation.
- No modification of the P9 read-only transport into a write-capable transport.
- No Production connection during adapter implementation, test, preflight, or
  documentation work.

## Existing Contracts

### Runner Contract

`scripts/qa/release-b-production-runner.mjs` is the CLI composition root.

Current exported behavior:

- `preflightReleaseBProductionRunner({ environment })` delegates to
  `preflightReleaseBProductionTransport()` with placeholder functions. It
  returns value-blind metadata and must not connect, start a transaction, run
  SQL, or consume authorization.
- `createReleaseBProductionRunnerTransport(options)` currently returns
  `createReleaseBProductionTransport(options)`.
- `runReleaseBProductionRunner({ args, environment, authorizationReceipt,
  authorizationReceiptSha256, createSession, readPostcheck })` requires exactly
  `args: ["--execute-production"]`, rejects v1/v2 receipts, validates the
  current v3 authorization against computed execution-surface fingerprints,
  constructs the transport, and calls `executeReleaseBProductionImport()`.
- The CLI `main()` path currently loads the receipt but does not pass
  `createSession` or `readPostcheck`.

Future runner composition must import the new adapter module, call
`createReleaseBProductionPostgresAdapter({ environment })` only after v4
authorization validation succeeds, and pass the returned `createSession` and
`readPostcheck` into `createReleaseBProductionTransport()`.

### Production Transport Contract

`scripts/qa/lib/release-b-production-transport.mjs` owns the Production
transport contract.

`createReleaseBProductionTransport({ environment, createSession, readPostcheck })`
requires:

- `environment.P9_PRODUCTION_DATABASE_URL` exists and is accepted by
  `parseP9Connection({ mode: "PRODUCTION", dsn })`.
- `createSession` is a function.
- `readPostcheck` is a function.
- Caller-supplied SQL renderers are forbidden.

The transport calls `createSession({ pgEnv, safeTarget })`. The returned session
must be an object with:

- `targetIdentity`: expected/config-derived connection-target metadata. It must
  include `projectRef`, `host`, and `port` matching `safeTarget`, and it is used
  to prove the adapter did not swap the parsed target while constructing the
  driver session. It is not independently observed remote database identity.
- `query(sql, params?)`: async function returning driver-shaped result objects.
  The transport uses `.rows` and sometimes `.rowCount` / `.affectedRows`.
- `close()`: async or promise-compatible function. It must close the session
  exactly once per transport operation.

The transport opens a fresh session for each of:

- `identifyTarget()`
- `readPrecheck()`
- `readPostcheck()`
- `transaction(work)`

The transport, not the adapter, sends:

- `SELECT current_database() AS current_database, current_user AS current_user,
  inet_server_port()::text AS server_port;`
- `BEGIN;`
- `SET CONSTRAINTS ALL DEFERRED;`
- `LOCK TABLE ... SHARE ROW EXCLUSIVE MODE` through
  `RELEASE_B_LOCKED_PRECHECK_SQL`
- rendered Release B `INSERT` / `UPDATE` statements
- `COMMIT;`
- `ROLLBACK;`

The transport enforces:

- target identity match before writes
- database-observed identity checks from
  `SELECT current_database() AS current_database, current_user AS current_user,
  inet_server_port()::text AS server_port;`; these values are the observed
  server-side evidence and must continue to be validated separately from
  config-derived `targetIdentity`
- single-statement write scope
- no DELETE, TRUNCATE, DDL, grants, revokes, COPY, VACUUM, ANALYZE, comments, or
  migration-history mutation
- read-only postcheck SQL filtering
- transaction phase tracking
- connection-loss classification

### Executor / Importer Contract

`scripts/qa/release-b-production-import.mjs` owns authorization, immutable plan
binding, durable consumption, and postconditions.

`executeReleaseBProductionImport(input)`:

- requires `args: ["--execute-production"]`
- rejects v1/v2 receipts
- loads the frozen Task 17 gate
- validates the current authorization receipt and execution-surface fingerprints
- proves committed input bytes match the frozen gate
- rebuilds the recovery plan from committed repository inputs
- validates operation counts and delete-free scope
- requires a transport implementing `identifyTarget`, `readPrecheck`,
  `transaction`, and `readPostcheck`
- calls `transport.identifyTarget()` before ledger consumption
- atomically creates the durable `STARTED` ledger entry before transaction work
- runs `runRecoveryPlanTransaction()`
- asserts the transaction-bound precheck through `readPrecheckForUpdate()`
- asserts the post-commit verification result after `transport.readPostcheck()`

The executor maps ambiguous transaction or postcheck errors to
`RELEASE_B_EXECUTION_AMBIGUOUS`. The executor does not retry and never removes
the consumed ledger entry.

### P9 Connection Validation Contract

`scripts/qa/p9-readonly-postgres-transport.mjs` currently exports
`parseP9Connection({ mode, dsn })`.

For `mode: "PRODUCTION"` it accepts only:

- direct endpoint: expected project direct host, port `5432`, database
  `postgres`, user `postgres`
- Session Pooler endpoint: expected provider Session Pooler host, port `5432`,
  database `postgres`, user `postgres.<project-ref>`

It rejects Transaction Pooler port `6543` and any other host/user/project shape.
It returns:

- `safeTarget`: value-blind target metadata including `mode`, `host`,
  `projectRef`, `port`, `database`, and `endpointClass`.
  Release B adapter/transport execution enriches this target with
  `databaseRole`, the PostgreSQL session role `postgres`; it is intentionally
  distinct from the Supabase Session Pooler login username
  `postgres.<project-ref>`.
- `pgEnv`: libpq-style fields `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`,
  `PGPASSWORD`, and `PGSSLMODE`

For Production, `PGSSLMODE` is forced to `require` by the parser, independent of
the URL query string. The adapter must reuse this parser and must not log,
serialize, print, hash for output, persist, or expose any DSN, password, host,
username, URL, prefix, suffix, or credential-derived value beyond existing
value-blind metadata.

Although the parser currently accepts both the direct endpoint and Session
Pooler, the future adapter must restrict Release B execution to the Session
Pooler shape unless a separately reviewed authorization changes that policy.

### Authorization Contract

The current executable schema is
`openglass-device-schema-v1-release-b-authorization-v3`, but any code change to
runner, transport, executor, or a new adapter invalidates approval-3 for
execution.

Future execution after adapter implementation requires
`openglass-device-schema-v1-release-b-authorization-v4`. V4 must bind at least:

- exact final HEAD / code identity following existing repository conventions
- Production transport fingerprint
- Production executor fingerprint
- Production runner fingerprint
- Production PostgreSQL adapter fingerprint
- normalized payload SHA-256
- dry-run fingerprint
- target project ref
- expected-before counts
- expected-after counts
- `maxAttempts: 1`
- `automaticRetry: false`
- existing false safety flags for deletes, schema mutation, migration-history
  mutation, Cloudflare writes, deploy, push, merge, and `qa:prod`

V4 must reject unknown fields and v1/v2/v3 receipts for the adapter-bound runner
path. This design does not fabricate a v4 receipt.

## Architectural Decision

Create a dedicated adapter module:

`scripts/qa/lib/release-b-production-postgres-adapter.mjs`

Conceptual dependency flow:

```text
P9_PRODUCTION_DATABASE_URL
  |
  v
parseP9Connection({ mode: "PRODUCTION", dsn })
  |
  v
release-b-production-postgres-adapter.mjs
  |-- createSession({ pgEnv, safeTarget })
  `-- readPostcheck({ queryReadOnly })
  |
  v
release-b-production-transport.mjs
  |
  v
release-b-production-import.mjs
```

The adapter is the only new module that knows how to open and close a native
PostgreSQL driver session. It returns collaborators; it does not call the
executor itself and does not accept raw mutation SQL from an operator.

## Alternatives Considered

1. **Option A: dedicated Production PostgreSQL adapter.** Selected. It creates a
   small reviewed bridge from the existing P9 connection contract to the already
   reviewed transport contract, while preserving the executor and transport
   safety boundaries.
2. **Option B: add generic database abstraction.** Rejected. Existing contracts
   need only one explicit Release B adapter. A generalized abstraction would add
   extra surface area, pool/retry questions, and unrelated behavior.
3. **Option C: reuse P9 read-only capture or `psql`.** Rejected. P9 is a
   read-only packet-capture transport implemented through `psql` spawn. Release B
   execution must not use `psql`, manual SQL shelling, or a write-capable variant
   of that module.
4. **Option D: Supabase REST/RPC or Supabase tools.** Rejected. The Release B
   contract is PostgreSQL transaction semantics with explicit `BEGIN`, table
   locks, SQLSTATE behavior, and commit-ack ambiguity. REST/RPC would be an
   alternate execution path and would not satisfy the existing transport
   contract.

## Module Boundaries

Expected future file boundaries:

Created:

- `scripts/qa/lib/release-b-production-postgres-adapter.mjs`
- `scripts/qa/test-release-b-production-postgres-adapter.mjs`
- a disposable PostgreSQL adapter integration test file, name to be selected in
  the implementation plan

Modified:

- `scripts/qa/release-b-production-runner.mjs` to compose the reviewed adapter
  after v4 validation
- `scripts/qa/release-b-production-import.mjs` to add v4 schema/fingerprint
  binding
- `scripts/qa/test-release-b-production-runner.mjs` for v4 runner composition
  and historical v3 rejection
- `scripts/qa/test-device-schema-v1-transaction-contract.mjs` for v4 binding and
  ambiguity/no-retry cases if needed
- `docs/ops/device-schema-v1-release-b-transaction-runbook.md` after
  implementation to document v4 execution requirements
- `package.json` and `package-lock.json` only if a native PostgreSQL driver must
  be added

Intentionally untouched:

- `scripts/qa/p9-readonly-postgres-transport.mjs` except for unrelated future
  read-only P9 work
- `scripts/devices/schema-v1/disposable-postgres-transaction-client.mjs`
  business SQL rendering, unless a separate review changes the renderer itself
- existing migrations and migration history
- Production ledger contents
- Cloudflare, deploy, merge, and `qa:prod` surfaces

## PostgreSQL Driver Decision

Repository evidence shows `@supabase/supabase-js` and its
`@supabase/postgrest-js` dependency, but no installed native PostgreSQL driver
such as `pg`, `postgres`, or `postgres.js`.

Decision: use a minimal standard native PostgreSQL Node driver dependency for
the QA/operator adapter in the future implementation. The expected dependency is
`pg` unless the implementation review discovers a stronger already-installed
native driver before code is written. `pg` is preferred because it provides a
direct client, parameterized queries, SQLSTATE exposure, explicit connection
close, TLS configuration, and no ORM or pooling requirement.

Because the adapter lives under `scripts/qa` and is not part of the
Astro/Cloudflare application runtime, `pg` should be added as a `devDependency`.
The implementation must verify that the normal application build does not bundle
or require `pg` in the deployed Cloudflare runtime, and no app/runtime source may
import `scripts/qa/lib/release-b-production-postgres-adapter.mjs`. If current
package conventions make `devDependencies` impossible, the implementation plan
must record the evidence before choosing another dependency scope.

The adapter must use a single `Client` per session. It must not use a `Pool`
unless a later reviewed spec changes the requirement; pooling is unnecessary for
one bounded operation and complicates lifecycle evidence.

## TLS Contract

The implementation must determine and document the exact supported `pg.Client`
TLS configuration before code is finalized. This spec deliberately does not
invent that final configuration because the current repository does not contain
provider- or driver-specific evidence sufficient to prove it.

Load-bearing requirements:

- encrypted TLS is mandatory for Production sessions
- the adapter must fail closed rather than downgrade TLS
- `rejectUnauthorized: false` is forbidden unless a separate reviewed security
  decision proves it necessary and acceptable
- hostname and certificate verification must be preserved when supported by the
  provider and driver configuration
- implementation planning may include a documentation verification step for the
  chosen `pg` / Supabase configuration
- contract tests must assert that the adapter does not silently weaken TLS
  settings to make a connection succeed
- disposable integration evidence must cover the final TLS branch where a local
  TLS target is available; if local TLS is not available, tests must still prove
  the Production configuration object fails closed on unsupported or explicitly
  downgraded TLS settings

## Adapter API

Conceptual API:

```js
createReleaseBProductionPostgresAdapter({ environment = process.env, Client })
```

Return value:

```js
Object.freeze({
  createSession,
  readPostcheck,
})
```

`Client` may be injectable only for tests. Production code must default to the
chosen native driver. Injection must not provide SQL rendering, authorization,
retry, ledger, or payload behavior.

`createSession({ pgEnv, safeTarget })`:

- validates that `safeTarget.endpointClass === "SUPAVISOR_SESSION"`
- constructs one native PostgreSQL client from `pgEnv`
- connects once
- returns `{ targetIdentity, query, close }`
- sets `targetIdentity` from `safeTarget`, not from a credential string; this is
  expected/config-derived target metadata only, and not database-observed proof
  by itself
- implements `query(sql, params)` by delegating to the native driver without
  logging SQL or parameters
- implements `close()` by closing the native client and never retrying close

`readPostcheck({ queryReadOnly })`:

- accepts only the transport-supplied `queryReadOnly` function
- issues fixed read-only verification queries through that function
- returns the exact object consumed by `assertPostcheck()`:
  `{ counts, uniqueSlugs, publishedDevices, conflictInvariants,
  rayBanIdentity, unexpectedDeletes }`
- does not compare to expected values; expected-value policy remains in the
  executor

## Session Lifecycle

The transport owns when sessions are opened. The adapter owns how one native
session is opened and closed.

For each transport call:

1. Transport calls `createSession({ pgEnv, safeTarget })`.
2. Adapter validates Session Pooler endpoint class.
3. Adapter creates a native client with `host`, `port`, `database`, `user`,
   password, and the reviewed TLS configuration derived from the existing
   Production `PGSSLMODE=require` contract.
4. Adapter connects once.
5. Adapter returns a session wrapper.
6. Transport calls `session.query(...)` as needed.
7. Transport calls `session.close()` in `finally`.
8. Adapter closes the native client once.

The adapter must not implicitly reconnect a closed session. A query on a closed
or broken session must surface the native error with its SQLSTATE or connection
code preserved where possible.

Target metadata semantics:

- expected/config-derived properties: `safeTarget.mode`, `safeTarget.host`,
  `safeTarget.projectRef`, `safeTarget.port`, `safeTarget.database`,
  `safeTarget.databaseRole`, `safeTarget.endpointClass`, and session
  `targetIdentity`
- database-observed properties: `current_database`, `current_user`, and
  `server_port` returned by the existing transport identity query

For the reviewed Production Session Pooler path, `PGUSER` remains the pooler
authentication username, while database identity validation compares
`current_user` with `safeTarget.databaseRole`.

The design must not treat copying `safeTarget` into `targetIdentity` as
sufficient proof of remote identity. The existing transport identity query must
remain the database-side evidence. No new target-discovery SQL is required by
the current contract.

## Transaction Semantics

`scripts/qa/lib/release-b-production-transport.mjs` owns transaction
orchestration. The adapter must not send `BEGIN`, `COMMIT`, `ROLLBACK`,
`SAVEPOINT`, lock statements, or deferred-constraint statements on its own.

Current transport order:

1. Open one session.
2. Send `BEGIN;`.
3. Send `SET CONSTRAINTS ALL DEFERRED;`.
4. Expose `readPrecheckForUpdate()` and `upsert(entity, row)` to the executor.
5. Require `readPrecheckForUpdate()` before the first write.
6. Render and guard each Release B write through the closed renderer.
7. Send `COMMIT;`.
8. Close the session.

Rollback path:

1. If failure occurs before commit is sent, and rollback is still meaningful,
   transport sends `ROLLBACK;`.
2. If commit acknowledgement is uncertain, transport must not send or claim
   rollback.
3. Transport closes the session and classifies close failures according to phase.

The adapter must preserve native driver error codes so the transport and
executor can classify ambiguity correctly.

## SQL Ownership And Safety Guards

SQL ownership remains exactly where it is today:

- Release B mutation SQL rendering:
  `scripts/devices/schema-v1/disposable-postgres-transaction-client.mjs`
  `renderReleaseBAuthorizedOperation()`
- Recovery write selection and ordering:
  `scripts/devices/schema-v1/recovery-transaction.mjs`
  `collectApprovedRecoveryWrites()` and `runRecoveryPlanTransaction()`
- Production write scope and forbidden SQL classification:
  `scripts/qa/lib/release-b-production-transport.mjs`
  `allowedSql()` / `FORBIDDEN_WRITE`
- Read-only postcheck SQL classification:
  `scripts/qa/lib/release-b-production-transport.mjs` `readOnlySql()`
- Authorization, payload, expected counts, ledger, and retry policy:
  `scripts/qa/release-b-production-import.mjs`

The adapter may own only driver calls and fixed postcheck query composition. It
must not accept operator-supplied SQL and must not expose a public generic SQL
client.

Parameterized SQL is required wherever the adapter supplies parameters to the
driver. The current transport mutation renderer emits closed, data-derived SQL
strings; changing that renderer to parameterized statements is outside this
adapter spec.

## Post-Commit Verification

`transport.readPostcheck()` opens a fresh session after the transaction
completes and passes `queryReadOnly(sql, params)` to the injected
`readPostcheck()`.

The adapter's `readPostcheck()` must:

- use only `queryReadOnly`
- issue fixed `SELECT` / `WITH` queries
- rely on the transport's read-only classifier to reject writes
- return counts using the executor's camelCase keys:
  `devices`, `deviceSpecDefinitions`, `deviceSpecs`, `deviceSources`,
  `deviceSourceLinks`, `deviceSpecEvidence`, `catalogAuditEvents`
- return `uniqueSlugs`
- return `publishedDevices`
- return `conflictInvariants` as `"PASS"` only when all existing verification
  predicates pass
- return `rayBanIdentity` as the observed Ray-Ban device slug result
- return `unexpectedDeletes` as an observed count, not an expected-policy
  decision

The executor remains the only component that decides whether those values match
Release B expectations.

## Error Classification

| failure | stage | rollback? | authorization state | retry allowed? | classification |
|---|---|---:|---|---:|---|
| Missing `P9_PRODUCTION_DATABASE_URL` | adapter/transport construction | no | not consumed | no | `PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE` |
| Invalid target shape or non-Session Pooler for adapter execution | adapter/transport construction | no | not consumed | no | `PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE` or adapter-specific fail-closed code before connection |
| Identify-target session connection failure | `identifyTarget()` before durable ledger consumption | no transaction | not consumed; ledger remains absent | no | deterministic target/connection classification; connection-loss codes must not consume authorization because this happens before ledger creation |
| Identify-target authentication failure | `identifyTarget()` before durable ledger consumption | no transaction | not consumed; ledger remains absent | no | deterministic native auth classification with secret-safe reporting |
| Target identity mismatch | `identifyTarget()` database-observed identity check | no | not consumed | no | `RELEASE_B_TARGET_MISMATCH` |
| Transaction-session connection failure before `BEGIN` succeeds | `BEFORE_BEGIN` after durable `STARTED` ledger entry | no transaction | consumed; ledger must not be deleted or reset | no | `RELEASE_B_SAFE_FAILURE_BEFORE_BEGIN` when surfaced through transaction |
| Transaction-session authentication failure before `BEGIN` succeeds | `BEFORE_BEGIN` after durable `STARTED` ledger entry | no transaction | consumed; ledger must not be deleted or reset | no | deterministic native auth code unless transport classifies as connection loss |
| Transaction-bound precheck drift | after `BEGIN`, before first write | yes, must attempt rollback | consumed | no | `RELEASE_B_PRODUCTION_PRECONDITION_DRIFT` |
| Deterministic SQL failure before commit | after first write, before commit | yes, must attempt rollback | consumed | no | preserve native error code / SQLSTATE |
| Rollback acknowledgement lost | rollback path | no acknowledged rollback | consumed | no | phase-based connection-loss classification, ambiguous if executor receives ambiguity predicate |
| Connection loss after first write before commit | after first write, before commit | rollback may be impossible | consumed | no | `TRANSPORT_AFTER_FIRST_WRITE`, then executor maps ambiguity to `RELEASE_B_EXECUTION_AMBIGUOUS` |
| Commit acknowledgement lost | `COMMIT_SENT_ACK_NOT_RECEIVED` | no rollback claim | consumed | no | `COMMIT_UNKNOWN`, then executor maps to `RELEASE_B_EXECUTION_AMBIGUOUS` |
| Close failure after acknowledged commit | after `COMMIT_SENT_ACK_RECEIVED` | no | consumed | no | ignored unless it blocks postcheck |
| Postcheck-session connection or authentication failure | after acknowledged `COMMIT`, before/during read-only verification | no | consumed; ledger must not be deleted or reset | no | inability to prove post-commit state preserves existing ambiguity / postcommit verification semantics |
| Postcheck deterministic mismatch | post-commit verification | no | consumed | no | `RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED` |
| Postcheck transport/provider loss | post-commit verification | no | consumed | no | `RELEASE_B_EXECUTION_AMBIGUOUS` |

The adapter must not catch and replace native errors with vague messages that
hide `code`, `sqlState`, or `message` patterns used by existing classifiers.
Any sanitization must happen only at reporting boundaries and must not destroy
classification fields.

## Commit Ambiguity Semantics

The critical invariant is unchanged:

`COMMIT` sent but acknowledgement not received means the outcome is unknown.

The adapter must not:

- retry `COMMIT`
- reconnect to infer success inside the transaction call
- send `ROLLBACK` after a commit acknowledgement loss
- transform the error into a deterministic failure
- start a second transaction

The transport currently sets phase `COMMIT_SENT_ACK_NOT_RECEIVED` immediately
before `session.query("COMMIT;")`. A connection-loss error from that call
classifies as `COMMIT_UNKNOWN`; the executor's ambiguity predicate maps that to
`RELEASE_B_EXECUTION_AMBIGUOUS`. That outcome consumes authorization and forbids
retry.

## Credential Handling

Connection source:

- only `P9_PRODUCTION_DATABASE_URL`
- only from the process environment object supplied to the runner/adapter
- no dotenv loading by the adapter
- no repository persistence
- no config-file persistence
- no command-line DSN argument
- no stdout/stderr printing
- no hash, length, prefix, suffix, host, username, password, or URL disclosure

The adapter must pass credentials to the native driver in memory only. Tests
must include sentinel credentials and assert they do not appear in thrown error
messages, JSON artifacts, receipts, or logs controlled by this code. Native
driver messages that include secret-shaped content must be wrapped only at the
outer reporting boundary with classification preserved.

## Authorization V4 Binding

V4 is required before any adapter-bound Production execution.

Implementation requirements:

- add `AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4`
- add strict v4 key inventory
- reject v1/v2/v3 receipts on the adapter-bound runner path
- add adapter path and adapter fingerprint to execution-surface computation
- validate the adapter fingerprint before any Production connection is opened
- keep `maxAttempts: 1`
- keep `automaticRetry: false`
- keep all existing false capability flags
- bind the exact final HEAD / code identity using existing conventions
- update tests so approval-3 becomes historical and non-executable after the
  adapter code change

No v4 authorization artifact is produced by this spec.

## Test Strategy

TDD is required. The first implementation step must add failing tests before
adapter code.

### Unit

Synthetic/fake collaborators only:

- adapter module import has zero side effects and opens zero connections
- missing credential fails closed before driver construction
- invalid P9 target fails closed before driver construction
- direct endpoint is rejected for adapter execution unless a separate review
  authorizes it
- Session Pooler target creates a single client session
- Production TLS configuration is explicit, encrypted, and fail-closed; tests
  must reject silent downgrade, including any unreviewed
  `rejectUnauthorized: false`
- `query(sql, params)` passes SQL and params through to the driver
- `close()` ends the client once
- close failure does not trigger retry
- no automatic reconnect or retry occurs for connect/query/commit/close errors
- no DSN, password, host, username, URL, length, hash, prefix, or suffix appears
  in adapter-controlled output
- `readPostcheck()` uses only `queryReadOnly`
- unsafe postcheck SQL is rejected by the existing transport guard
- v3 receipts are non-executable after adapter code exists
- v4 binds the adapter fingerprint

### Contract

Contract tests must use fake driver/session implementations and the real
Production transport:

- runner composition passes adapter `createSession` and `readPostcheck` into
  `createReleaseBProductionTransport()`
- transport construction still opens zero sessions
- `identifyTarget()` validates both database identity and `targetIdentity`
- tests distinguish identify-target, transaction-session, and postcheck-session
  connection/authentication failures and their ledger consequences
- transaction sends discrete `BEGIN;`, `SET CONSTRAINTS ALL DEFERRED;`, locked
  precheck, writes, and `COMMIT;`
- deterministic SQLSTATE is preserved after acknowledged rollback
- connection loss after first write maps to ambiguity
- lost commit acknowledgement maps to `RELEASE_B_EXECUTION_AMBIGUOUS` through the
  executor
- approval consumption prevents retry

### Disposable PostgreSQL Integration

Use only an owned local/disposable PostgreSQL target. Never use Production.

The integration suite must prove with real PostgreSQL behavior:

1. connect succeeds
2. parameterized query works
3. `BEGIN` / write / `COMMIT` persists
4. `BEGIN` / write / `ROLLBACK` does not persist
5. transaction error rolls back
6. fresh postcheck reads committed state
7. postcheck is read-only
8. disconnect lifecycle works
9. controlled ambiguous commit boundary maps to
   `RELEASE_B_EXECUTION_AMBIGUOUS`
10. no retry occurs

If the chosen driver cannot deterministically reproduce a real network-level
lost commit acknowledgement in local integration, tests must split the claim:

- integration proves driver lifecycle and real PostgreSQL transaction behavior
- contract tests inject a driver/session failure exactly at `COMMIT;` and verify
  the existing transport/executor ambiguity boundary

The implementation must not claim an end-to-end network ambiguity reproduction
unless the test actually severs or simulates the native connection at the
commit-ack boundary in a deterministic local setup.

### Full Release B Rehearsal

Run the existing normalized payload through:

```text
runner
  -> adapter
  -> transport
  -> executor
```

against disposable PostgreSQL only.

Verify exact post-Release B counts:

- `devices=24`
- `device_spec_definitions=92`
- `device_specs=1488`
- `device_sources=39`
- `device_source_links=46`
- `device_spec_evidence=15`
- `catalog_audit_events=0`

Also verify:

- `uniqueSlugs=24`
- `publishedDevices=24`
- conflict invariants pass
- Ray-Ban identity is `ray-ban-meta`
- unexpected deletes are zero
- rollback/atomicity rehearsal leaves zero partial committed application rows
- consumed authorization cannot retry

## Production Execution Ordering

Current code-derived ordering:

1. CLI parses `--execute-production` and receipt arguments.
2. Runner loads receipt.
3. Runner requires v4 in the future adapter-bound path.
4. Runner loads frozen gate.
5. Runner computes execution-surface fingerprints, including adapter
   fingerprint in v4.
6. Runner validates receipt and code/fingerprint binding.
7. Runner creates adapter collaborators without opening a connection.
8. Runner creates Production transport without opening a connection.
9. Executor revalidates v4 receipt and execution-surface binding.
10. Executor verifies committed input bytes.
11. Executor rebuilds and validates the immutable Release B plan.
12. Executor verifies transport contract.
13. Executor calls `transport.identifyTarget()`, which opens the first
    Production session and validates target identity.
14. Executor atomically consumes the durable ledger entry.
15. Executor calls `transport.transaction(...)`.
16. Transport opens a transaction session.
17. Transport sends `BEGIN;`.
18. Transport sends `SET CONSTRAINTS ALL DEFERRED;`.
19. Executor calls `readPrecheckForUpdate()` before writes.
20. Transport sends the locked precheck.
21. Executor sends approved writes through `upsert(entity, row)`.
22. Transport renders and guards each SQL statement.
23. Transport sends `COMMIT;`.
24. Transport closes the transaction session.
25. Executor calls `transport.readPostcheck()`.
26. Transport opens a fresh postcheck session.
27. Adapter `readPostcheck()` runs read-only verification through
    `queryReadOnly`.
28. Transport closes the postcheck session.
29. Executor asserts postcheck values and returns `COMMITTED`.

The first Production connection must not happen before explicit
`--execute-production`, valid v4 receipt, exact fingerprint/code bindings, exact
payload/count bindings, and all local fail-closed validation up to the
`identifyTarget()` stage.

Connection-stage consequences are ordered by this section:

- identify-target session failures happen at stage 13, before the durable ledger
  entry is created at stage 14, so the approval remains unconsumed
- transaction-session failures happen at stage 16 or later, after the durable
  `STARTED` ledger entry, so authorization is consumed and must not be retried
- postcheck-session failures happen at stage 26 or later, after acknowledged
  commit, so authorization is consumed and inability to prove final state must
  preserve the existing ambiguity / postcommit verification semantics

## Observability / Evidence

Evidence must be value-blind.

Allowed evidence:

- enum classifications
- exact file paths and function names
- exact commit/fingerprint values that are code or payload fingerprints already
  part of the reviewed authorization model
- counts
- booleans for connection attempted/opened/closed
- endpoint class such as `SUPAVISOR_SESSION`
- retry count
- transaction phase labels

Forbidden evidence:

- DSN
- host
- username
- password
- URL
- credential length
- credential hash
- credential prefix/suffix
- SQL parameter values if they contain secrets
- provider dashboard output

## Failure Recovery Rules

- `maxAttempts=1`
- `automaticRetry=false`
- no adapter reconnect
- no runner retry
- no manual retry
- no alternate SQL client
- no manual SQL
- no ledger deletion or reset
- no migration-history mutation
- no reconciliation in the same authorization
- any uncertain commit state is `RELEASE_B_EXECUTION_AMBIGUOUS`
- ambiguous or deterministic failures consume authorization once the ledger
  entry is created
- a fresh reviewed authorization is required for any future attempt after a
  consumed, failed, or ambiguous result

## Compatibility / Migration

The adapter is additive until the runner is changed to compose it. Existing
read-only P9 tooling, local disposable replay tooling, and historical v1/v2/v3
tests must continue to run.

If `pg` is added, `package.json` and `package-lock.json` must change in the same
implementation commit as adapter tests. It should be added as a QA/operator
`devDependency`; the implementation must prove the normal Astro/Cloudflare
runtime build does not bundle or require it. No global driver abstraction or
runtime database client migration is part of this work.

## Security Invariants

- module import: zero Production connections
- unit tests: zero Production connections
- integration tests: zero Production connections
- disposable rehearsals: zero Production connections
- preflight: zero Production connections, zero transactions, zero SQL, zero
  ledger consumption
- Production connection only after explicit execute flag and valid v4 binding
- no Production secrets in repository files, receipts, logs, stdout, stderr, or
  uploaded artifacts
- no DELETE
- no DDL
- no migration-history mutation
- no Cloudflare operation
- no deploy
- no merge
- no `qa:prod`
- no automatic retry
- no hidden reconnect
- no TLS downgrade; Production TLS must fail closed if the reviewed driver
  configuration cannot preserve required encryption and verification semantics
- no app/runtime import of the Production PostgreSQL adapter
- native PostgreSQL driver dependency remains QA/operator-only unless a separate
  evidence-backed packaging decision is reviewed

## Implementation Boundaries

Files expected to be created:

- `scripts/qa/lib/release-b-production-postgres-adapter.mjs`
- `scripts/qa/test-release-b-production-postgres-adapter.mjs`
- one disposable PostgreSQL integration/rehearsal test for the adapter-bound
  runner path

Files expected to be modified:

- `scripts/qa/release-b-production-runner.mjs`
- `scripts/qa/release-b-production-import.mjs`
- `scripts/qa/test-release-b-production-runner.mjs`
- `scripts/qa/test-release-b-production-transport.mjs`, only if adapter-facing
  contract coverage needs a new assertion
- `scripts/qa/test-device-schema-v1-transaction-contract.mjs`, only for v4 and
  ambiguity/no-retry boundary updates
- `docs/ops/device-schema-v1-release-b-transaction-runbook.md`
- `package.json` and `package-lock.json` if `pg` is added

Files intentionally untouched:

- `scripts/qa/p9-readonly-postgres-transport.mjs`
- migration files
- migration history
- Production ledger entries
- Cloudflare/deployment configuration
- Release B frozen payload inputs except where the existing executor already
  reads them

## Acceptance Criteria

- Design spec is committed before implementation planning.
- Future implementation begins with failing tests.
- Adapter module import opens zero connections.
- Adapter construction opens zero connections.
- Preflight opens zero connections and consumes zero authorization.
- Runner execution path cannot execute v1/v2/v3 receipts after adapter code.
- V4 binds the adapter fingerprint.
- Session Pooler is the only adapter execution endpoint.
- Adapter exposes exactly `createSession` and `readPostcheck` to the transport.
- Transport remains transaction owner.
- Executor remains authorization, ledger, immutable payload, count, and
  ambiguity owner.
- SQL rendering and SQL guardrails remain in existing modules.
- Disposable PostgreSQL integration proves real transaction behavior.
- Full disposable Release B rehearsal proves the exact expected counts.
- Commit ambiguity is preserved as `RELEASE_B_EXECUTION_AMBIGUOUS`.
- No retry occurs.
- No Production connection occurs during implementation or verification.
- TLS cannot silently downgrade; final `pg.Client` TLS behavior is explicitly
  reviewed, encrypted, and covered by contract/integration evidence.
- Identify-target, transaction-session, and postcheck-session
  connection/authentication failures have distinct ledger and authorization
  semantics consistent with Production execution ordering.
- Expected/config-derived target metadata is not treated as observed server
  identity; the existing database-observed identity query remains required.
- `pg` remains QA/operator-only and does not enter the deployed
  Astro/Cloudflare runtime bundle.

## Open Questions

None. Repository evidence resolves the adapter boundary, driver absence,
transaction owner, SQL owner, authorization owner, and required v4 binding.

## Decision Record

Option A was selected because the missing piece is not Release B semantics; it
is the narrow native PostgreSQL bridge required by the existing Production
transport. The current transport already owns target checks, transaction
control, SQL scope, and ambiguity classification. The executor already owns
authorization, ledger consumption, immutable payload validation, and expected
postconditions. A dedicated adapter lets those reviewed boundaries remain
intact.

Option B was rejected because adding a generalized database abstraction would
solve more than the current problem and introduce pooling/retry/ORM decisions
that the Release B contract does not need.

Option C was rejected because P9 read-only capture is intentionally read-only
and implemented through `psql` spawn. Making it write-capable would create the
alternate SQL path this work is meant to avoid.

Supabase REST/RPC and tool-based execution were rejected because they bypass the
native PostgreSQL transaction, lock, SQLSTATE, and commit-acknowledgement
semantics that the existing Release B transport and executor require.
