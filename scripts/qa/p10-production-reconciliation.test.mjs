import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import { P10_RECONCILIATION_SQL_SHA256, createP10Transcript, runP10Reconciliation, validateP10Source } from "./p10-production-reconciliation.mjs";

const localDsn = "postgresql://postgres:fake-password@127.0.0.1:5432/postgres?sslmode=disable";
const sql = "SELECT 1;";
const sqlHash = createHash("sha256").update(sql).digest("hex").toUpperCase();

test("P10TX-01 rejects a source commit mismatch before spawning", () => {
  assert.throws(() => validateP10Source({ actualCommit: "a".repeat(40), approvedCommit: "b".repeat(40), worktreeClean: true }), /P10_SOURCE_BINDING_FAILED/);
});

test("P10TX-02 emits a single explicit transaction without credential-bearing argv", async () => {
  let spawned = 0; let args; let input = "";
  const spawnImpl = (_exe, argv) => {
    spawned += 1; args = argv;
    const child = new EventEmitter(); child.pid = 8080; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end(value) { input = value; queueMicrotask(() => child.emit("close", 1)); } };
    return child;
  };
  const evidence = await runP10Reconciliation({ mode: "LOCAL_TEST", dsn: localDsn, migrationSql: sql, expectedSqlHash: sqlHash, approvedCommit: "a".repeat(40), actualCommit: "a".repeat(40), worktreeClean: true, spawnImpl });
  assert.equal(spawned, 1);
  assert.match(input, /BEGIN;/);
  assert.match(input, /COMMIT;/);
  assert.match(input, /ROLLBACK;/);
  assert.equal(args.some((value) => value.includes("fake-password") || value.includes("postgresql://")), false);
  assert.equal(evidence.rollbackMode, "CONNECTION_CLOSE_ROLLBACK");
  assert.equal(evidence.failureDetail.includes("fake-password"), false);
});

test("P10TX-03 rejects a frozen SQL hash mismatch before spawn", async () => {
  await assert.rejects(() => runP10Reconciliation({ mode: "LOCAL_TEST", dsn: localDsn, migrationSql: "SELECT 2;", expectedSqlHash: sqlHash, approvedCommit: "a".repeat(40), actualCommit: "a".repeat(40), worktreeClean: true, spawnImpl: () => { throw new Error("must not spawn"); } }), /P10_SQL_HASH_MISMATCH/);
});

test("P10TX-04 creates a postcondition-bearing transcript", () => {
  const transcript = createP10Transcript({ migrationSql: sql });
  assert.match(transcript, /to_regclass\('public\.devices'\)/);
  assert.match(transcript, /COMMIT;/);
  assert.match(transcript, /ROLLBACK;/);
});

test("P10TX-05 freezes a value-blind 64-character reconciliation SQL hash", () => {
  assert.match(P10_RECONCILIATION_SQL_SHA256, /^[A-F0-9]{64}$/);
});
