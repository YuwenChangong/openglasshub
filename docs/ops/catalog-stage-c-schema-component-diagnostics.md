# Stage C SCHEMA Component Diagnostics

## Evidence And Differences

Historical Stage B execution at `fa057a360dde1178ac30665032e246d4a99cf2c5`
passed state 2. Stage C candidates `44cc730c` and `cee91ae5` timed out at
SCHEMA after 35,014 ms and 35,007 ms respectively. Only the second failure
proved CLIENT_QUERY_TIMEOUT; it had no server SQLSTATE. Neither proves schema
drift, corruption, server overload, lock contention or pooler fault. Both
connections closed. Preserve the historical receipts without rewriting them.

The Stage B transport, adapter and package-lock blobs are unchanged at
`cee91ae5`. The runtime STATE_SQL is exactly 4,242 UTF-8 bytes, SHA256
`d824566d382f19e2b720566af834b5c1b2fe613881a2807e5ca2d71c1863b917`.
The installed/locked PostgreSQL client is pg 8.23.0.

| Boundary | Successful Stage B | Stage C read-only V2 |
| --- | --- | --- |
| SQL bytes/digest | Same frozen STATE_SQL above | Exactly identical; no added schema work |
| Isolation | BEGIN READ ONLY; no explicit override (server default not measured) | BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY |
| Snapshot boundary | Identity and each state capture in separate transactions | Identity, state, catalog/audit in one transaction |
| Startup client query timeout | 35s | 125s |
| Actual per-query client deadline | 30s, also capped by approval window | 35s; rollback corrected to 5s |
| Startup statement timeout | 30s configured | 120s configured |
| Startup lock timeout | 5s configured | 5s configured |
| Startup application name | catalog-stage-b-migration | catalog-stage-c-import |
| TLS/connection | Session Pooler, strict CA/hostname, 10s opening | Same parser/CA contract and opening limit |
| Pooler settings | Actual provider-side settings not captured | UNKNOWN; no provider configuration queried/changed |
| Dispatch/response | pg.Client query with empty values; rows[0].state | Same; full state passed to unchanged schema/ledger proof |
| Timeout cleanup | B's bounded rollback/close path | Client read timeout marks unusable, ends session; first error preserved |

These are meaningful differences, not proven causes. The known client timer
does not explain why no schema response arrived. No blanket timeout increase,
isolation change, SQL optimization or importer bypass is justified yet.

## Exact Projections, Not A Replacement Proof

`catalog-production-schema-diagnostics.mjs` reads only the hash-pinned
STATE_SQL. A delimiter reader handles its nested calls and quoted strings and
identifiers, rejects drift, and extracts the original expressions verbatim.
Every probe retains the original relations CTE and selects exactly one existing
expression as `component`. No tables, filters, joins, ordering, ACLs or function
definitions are changed. The probes, in order, are:

1. RELATIONS_ACL: schema.relations
2. COLUMNS: schema.columns
3. CONSTRAINTS: schema.constraints
4. INDEXES: schema.indexes
5. POLICIES: schema.policies
6. VIEWS: schema.views
7. TRIGGERS: schema.triggers
8. FUNCTIONS: schema.functions
9. LEDGER_SHAPE: ledgerShape
10. LEDGER_RECORDS: ledger
11. CATALOG_COUNTS: counts (devices, published, specs, definitions, audit)

The ledger shape retains its original owner, columns and primary-key subqueries.
The counts retain all five original counts. No unrestricted metadata collection,
EXPLAIN, pg_stat_activity query, raw definition output or new schema model.
Reassembling all values must equal the complete local STATE_SQL response and
its frozen state-2 digest. Returned values remain private in memory. Safe
diagnostics contain component ID, duration, COMPLETE/FAILED status, SQLSTATE,
fixed timeout/error classification and lock-timeout classification if proven.
Success alone does not prove that no wait occurred; waitClass stays UNKNOWN.

This is a separate diagnostic path, never imported by the production importer
as a substitute for full schema proof. All-components PASS is NOT proof that
the combined original query completes on Production. The importer still uses
its original full STATE_SQL, strict stage-2/ledger/ACL checks and unchanged
audit/admin protection and repeatable-read snapshot contract.

## Proposed Production Authorization Contract

Require a NEW exact human approval:
`AUTHORIZE_STAGE_C_SCHEMA_COMPONENT_DIAGNOSTICS`.
Previous read-only approvals are consumed and cannot authorize this SQL set.
Use only the existing approved private DPAPI input mechanism and Session
Pooler/strict CA. No credentials in chat, arguments, source or safe receipts.

Target identity SHA256:
`8722d50100719fbc618dffb57d08e6956462e15606c8c009e5736606e526a7f4`.
Verify this first via the unchanged IDENTITY_SQL. No identity row is persisted.

The fixed sequence is:

```sql
-- Unchanged IDENTITY_SQL, before opening the read-only transaction.
SELECT current_database() AS database, current_user AS role,
       inet_server_port() AS port, system_identifier::text AS system_identifier
FROM pg_control_system();
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
-- Eleven exact component SELECTs, rendered by renderSchemaDiagnosticSql().
ROLLBACK;
```

The generated review SQL artifact contains the actual eleven SELECTs, not the
placeholder above. Display it before requesting approval; bind its exact SHA256
and the final candidate/preparation packet. Each SET is counted separately.
Maximum: one connection, 12 SELECTs (identity plus 11 components), 16 SQL
statements including BEGIN/two SETs/one ROLLBACK. No complete STATE_SQL, catalog
snapshot, diagnostic monitor query, import or active authorization receipt.

Limits: connection 10s, each normal client query at most 15s, transaction-local
server statement timeout 10s and lock timeout 3s, rollback client deadline 5s.
The session deadline is 240s from diagnostic entry; client deadlines also cap
to remaining time. The private wrapper must also impose a 240s owned-child
watchdog, kill only that child on expiry, clear private input, and report BLOCKED
with cleanup UNKNOWN unless closure is proven. Never claim successful cleanup
solely from requesting termination. No SQL may be dispatched after expiry.

On the first failed/abnormal response, stop components. Preserve the first
safe error even if rollback fails. On client timeout the adapter closes the
active session; do not queue rollback or open a cancellation connection. On
server statement/lock cancellation, use the single remaining bounded rollback
then close. Success also ends with ROLLBACK and closes that same connection.
Zero reconnects, automatic retries, DDL, DML, imports, activation, deployments,
provider mutations or Stage B migrations.

## Local Evidence And Next Gate

The initial missing-harness test run was RED. Focused injected checks cover
fixed projection count/hash, drift rejection, finite ceilings, each timeout
class, private error redaction, first-error propagation despite cleanup failure,
identity mismatch before transaction, malformed response and total deadline.
The existing owned canonical-50/state-2 local rehearsal measures all components,
compares their reassembled private values to the full verifier and frozen
digest, and proves the full proof still rejects ACL mismatch before snapshot.
It also retains genuine lock wait, client timeout, server cancellation and
transaction cleanup tests and adds a slow-but-successful bounded response.
All existing audit and administrator-preservation tests remain unchanged.

There is no Production root-cause conclusion from local timing alone. If local
checks pass without proving the cause, stop for the targeted diagnostic gate.
After any proven correction, separately request
`AUTHORIZE_STAGE_C_READ_ONLY_RECONCILIATION_V3`; do not automatically reconnect,
run the combined query, generate a receipt, import or deploy. Only a successful
separately authorized V3 reconciliation reaches STAGE_C_IMPORT_PLAN_APPROVAL.
