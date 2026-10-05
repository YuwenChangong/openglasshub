# Catalog Stage B migration channel

## Authorization boundary

This is a dedicated operator channel, not a Release B or P9 scope expansion.
Implementation, imports, tests, and receipt preparation authorize **no Production
connection**. A future human execution approval must bind the final reviewed
candidate, artifacts, tooling, checkout, target, and a fresh execution window.
The previous Stage B authorization is not reusable.

The sole Production entrypoint is:

```text
node scripts/qa/catalog-production-migration-runner.mjs --execute-production --authorization-receipt <reviewed-receipt.json>
```

Without arguments it returns `NOT_AUTHORIZED`, zero connections, zero SQL.
Other argument shapes, including SQL, stdin, alternate paths, retry flags, and
extra arguments, are rejected. Module import has no connection side effect.
Do not execute this command as part of implementation or local verification.

## Future receipt

Use a JSON object with exactly the following fields. Store the reviewed receipt
outside the checkout so the required clean-worktree gate remains meaningful.

| Field | Required contract |
| --- | --- |
| `format` | `catalog-stage-b-authorization-v1` |
| `authorizationId` | New unique `stage-b-...` identifier; never reuse an attempt |
| `candidateHead` | Exact reviewed, clean execution HEAD, including this tooling |
| `executionCheckoutSha256` | Independently recorded local `checkoutIdentity(root)` result |
| `artifacts` | Exact `APPROVED_ARTIFACTS` object, including paths, hashes, versions, names, and property order |
| `toolingHashes` | SHA256 of each of the four exact `TOOLING_FILES` paths |
| `targetClass` | `SUPAVISOR_SESSION` only |
| `serverIdentitySha256` | Independently approved digest of the expected database identity row |
| `windowStartUTC`, `windowEndUTC` | Whole-second UTC ISO strings; fresh authorized interval, maximum 45 minutes |
| `maxAttempts`, `automaticRetry` | `1`, `false` |
| `readOnlyStatementBudget`, `writeTransactionBudget` | `30`, `2` |
| `humanGates` | Exactly the four true confirmations below |

The human gates are `productionDeploymentConfirmed`, `backupRecoveryReady`,
`catalogWritesPaused`, and `currentReaderCompatible`. Neither a successful
implementation receipt nor the 45-minute ceiling grants these confirmations.
Every query is deadline checked with a bounded timeout; authorization consumption
is checked again before opening the connection. Transaction controls and locks
are fixed; the read budget counts identity/schema SELECTs.

`checkoutIdentity(root)` hashes the canonical checkout path, Git common-directory
path, and that directory's creation/device/inode metadata. The authorization is
restricted to this one checkout and host. Another clone, moved checkout, or
recreated Git directory cannot reuse the receipt. Do not copy Git metadata or
move execution to another host. All worktrees share an exclusive, fsynced attempt
marker under the common Git directory, `catalog-stage-b-authorizations/<id>.json`.
It is consumed **before connecting**, including when connection establishment
fails. Never delete/reset it, retry from another clone, or issue a new ID to
continue an ambiguous attempt. Subsequent execution requires separate human
reconciliation and approval, not an automated retry.

The exact `APPROVED_ARTIFACTS` and `TOOLING_FILES` definitions are owned by
`scripts/qa/lib/catalog-production-migration-transport.mjs`. Their fixed scope is:

- Packet: `docs/superpowers/plans/2026-10-04-catalog-production-migration-packet.md`.
- Manifest: `artifacts/qa/catalog-migration-packet-v1/manifest.json`.
- Migration 1: `20261004003349_public_device_detail_v1.sql`, version `20261004003349`.
- Migration 2: `20261004014637_catalog_editor_presentation_v1.sql`, version `20261004014637`.
- Tooling: transport, PostgreSQL adapter, native runner, and schema-proof fixture.

Migration bytes are read once, hashed, detached, and retained for execution.
No operator statement, suffix, path override, SQL file, or repair statement is
accepted. Tooling/proof inputs are hash bound as well as candidate bound.

## Target and secret handling

Connection source name: `P9_PRODUCTION_DATABASE_URL`.
CA trust source name: `P9_PRODUCTION_DATABASE_CA_CERT_PATH`.
Do not put either source's contents in the receipt, repository, command line,
logs, or chat. Do not request or print credential values.

The adapter reuses `parseP9Connection` without changing P9. That parser enforces
the approved project and endpoint identity. Stage B additionally requires Session
Pooler, a valid explicit CA certificate, hostname verification, and one `pg`
connection attempt. Direct/transaction pooler, insecure TLS, fallback clients,
and reconnect are unavailable. Existing locked `pg` dependency is reused.

Inside an explicit read-only transaction, the fixed identity query observes
`current_database()`, `current_user`, `inet_server_port()`, and `system_identifier`
from `pg_control_system()`. SHA256 of the returned JSON row must equal the
independently approved `serverIdentitySha256`. Obtain that expected digest under
a separately approved read-only identity-verification process; never infer it,
learn-and-approve it from the execution connection, or omit it. This runbook does
not authorize that separate access. Permission failure or identity mismatch
stops before any migration. Only safe categories/digests are recorded; database
identity rows, DSNs, hostnames, usernames, passwords, and raw driver errors are
never printed.

## Ledger and transaction ownership

Canonical ledger: `supabase_migrations.schema_migrations`, owner `postgres`.
Primary key: `version text`. Columns: `version text NOT NULL`, `statements text[]`,
and `name text`. This was proved using the project's genuine disposable Supabase
baseline and its native migration history, not an invented history table.

The fixed ledger write is:

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ($1,$2,$3::text[]);
```

Parameters are the exact approved version, name, and a one-element array holding
the full exact executed migration body. The transport owns each transaction:

1. `BEGIN`; acquire fixed ledger/catalog table locks.
2. Recheck schema, ledger prefix, and catalog counts under the locks.
3. Execute the exact approved migration bytes.
4. Insert the canonical ledger row in the same transaction.
5. Verify schema/ledger/counts before COMMIT.
6. `COMMIT`, then fixed read-only post-verification.

Migration or ledger failure before COMMIT causes a best-effort ROLLBACK and STOP.
No path commits DDL separately from the ledger. Locks and statement timeouts are
bounded. No imported catalog data, ad-hoc GRANT/REVOKE, DELETE, TRUNCATE, COPY,
VACUUM, ledger repair, arbitrary SQL, or additional migration is permitted.

## Read-only classification and failure

The fixed schema query inspects only catalog definitions, policies, ACLs, views,
functions, triggers, the two ledger rows, and aggregate counts. No Auth data or
user-content payload is selected. The checked-in proof fixture contains only
three SHA256 schema states produced by the actual frozen migrations over the
genuine PostgreSQL 17 local baseline. A Production schema differing from these
exact definitions fails closed; do not regenerate the proof to accept drift.

- `MISSING`: correct baseline and no row; execute only the next exact migration.
- `ALREADY_APPLIED_CONSISTENT`: matching ordered version/name, exact full-body
  ledger statement hash, and corresponding schema; skip without a write.
- `LEDGER_SCHEMA_DIVERGENCE`: missing/out-of-order/fabricated ledger, different
  ledger statement bytes, or schema mismatch; STOP without repair.

Different ledger statement serialization, even from another legitimate tool,
is conservatively divergence in this channel. Do not rewrite ledger history to
satisfy it. Stage 2 compares the final combined schema because migration 2
intentionally changes some objects introduced by migration 1.

Loss of COMMIT acknowledgement is `AMBIGUOUS`: no retry, reconnect, or ROLLBACK
claim. Connection-close failure cannot replace that classification. A known
acknowledged commit followed by failed verification is `BLOCKED_AFTER_COMMIT`;
record the known commit count and STOP. Closing failure after otherwise successful
verification also prevents PASS. No Dashboard/manual SQL fallback is allowed.
Reconciliation, schema inspection, or recovery needs new separate authorization.

## Local proof and review

Focused tests: `node --test scripts/qa/test-catalog-production-migration-channel.mjs`.
Disposable rehearsal: `node scripts/qa/test-catalog-production-migration-local.mjs`.
The rehearsal uses OS-only child environment, an owned loopback Supabase stack,
the canonical 50-migration baseline, and the actual two migration files. It proves
permission-error rollback of real DDL and ledger writes, exact ordering, counts,
post-verification, consistent skipping, divergence, and no retry. Owned resources
are cleaned on exit. It neither accepts remote targets nor reads Production
credentials. Receipts are under `artifacts/qa/catalog-stage-b-channel/`.

COMMIT-acknowledgement/connection-close loss is a **synthetic transport contract
test**, using schema states observed from the real rehearsal. It is not claimed
as a real Production or network-fault exercise. Fixture capture is an explicit
local-only `--capture-schema-proof` operation that refuses to overwrite an
existing proof. A changed fixture requires fresh review, not operator repair.

Require focused tests, relevant untouched Release B/P9 regressions, and independent
`NO_P0_P1_P2` review before declaring this channel ready for execution review.
That declaration does not authorize Production execution, deployment, provider
changes, or reopening Slice C browser acceptance.
