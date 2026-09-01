import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  P9_EXPECTED_SESSION_POOLER_HOST,
  P9_EXPECTED_SESSION_POOLER_USER,
  P9_PACKET_SHA256,
  classifyPsqlFailure,
  classifyLegacyManagementResult,
  createPsqlTranscript,
  loadFrozenPacketUnits,
  parseP9Connection,
  parsePsqlTranscript,
  runP9ReadOnlyCapture,
} from "./p9-readonly-postgres-transport.mjs";

const root = process.cwd();
const packetPath = path.join(root, "docs", "ops", "p8-production-history-read-only.sql");
const productionDsn = "postgresql://postgres:fake-password@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require&application_name=fake-token";
const sessionPoolerDsn = "postgresql://postgres.xcbnxzjlsvtgzixurcof:fake-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";

test("P9TX-01 accepts only the approved direct production hostname", () => {
  const parsed = parseP9Connection({ mode: "PRODUCTION", dsn: productionDsn });
  assert.deepEqual(parsed.safeTarget, {
    mode: "PRODUCTION",
    host: "db.xcbnxzjlsvtgzixurcof.supabase.co",
    projectRef: "xcbnxzjlsvtgzixurcof",
    port: 5432,
    database: "postgres",
    endpointClass: "DIRECT",
  });
  assert.equal(parsed.pgEnv.PGPASSWORD, "fake-password");
});

test("P9POOL-01 accepts only the exact approved Supavisor session pooler target", () => {
  const parsed = parseP9Connection({ mode: "PRODUCTION", dsn: sessionPoolerDsn });
  assert.equal(P9_EXPECTED_SESSION_POOLER_HOST, "aws-1-ap-northeast-1.pooler.supabase.com");
  assert.equal(P9_EXPECTED_SESSION_POOLER_USER, "postgres.xcbnxzjlsvtgzixurcof");
  assert.deepEqual(parsed.safeTarget, {
    mode: "PRODUCTION",
    host: "aws-1-ap-northeast-1.pooler.supabase.com",
    projectRef: "xcbnxzjlsvtgzixurcof",
    port: 5432,
    database: "postgres",
    endpointClass: "SUPAVISOR_SESSION",
  });
});

for (const [id, dsn] of [
  ["P9POOL-02", "postgresql://postgres.xcbnxzjlsvtgzixurcof:fake-password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"],
  ["P9POOL-03", "postgresql://postgres.xcbnxzjlsvtgzixurcof:fake-password@aws-1-ap-northeast-1.pooler.supabase.com.attacker.example:5432/postgres"],
  ["P9POOL-04", "postgresql://postgres.xcbnxzjlsvtgzixurcof:fake-password@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"],
  ["P9POOL-05", "postgresql://postgres:fake-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"],
]) {
  test(`${id} rejects an unsafe session-pooler production target before any spawn`, () => {
    assert.throws(() => parseP9Connection({ mode: "PRODUCTION", dsn }), /P9_TARGET_VALIDATION_FAILED/);
  });
}

test("P9FAIL-01 classifies connection failures without retaining raw stderr", () => {
  assert.equal(classifyPsqlFailure("psql: error: connection to server at host failed: Network is unreachable"), "NETWORK_UNREACHABLE");
  assert.equal(classifyPsqlFailure("psql: error: could not translate host name"), "DNS_FAILURE");
  assert.equal(classifyPsqlFailure("psql: error: password authentication failed for user"), "AUTHENTICATION_FAILED");
  assert.equal(classifyPsqlFailure("psql: error: SSL certificate verify failed"), "SSL_FAILURE");
  assert.equal(classifyPsqlFailure("psql: error: server closed the connection unexpectedly"), "SERVER_CONNECTION_LOST");
});

for (const [id, dsn] of [
  ["P9TX-02", "postgresql://postgres:fake-password@db.wrongref.supabase.co:5432/postgres"],
  ["P9TX-03", "postgresql://postgres:fake-password@db.xcbnxzjlsvtgzixurcof.supabase.co.attacker.example:5432/postgres"],
  ["P9TX-04", "postgresql://postgres.xcbnxzjlsvtgzixurcof:fake-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"],
  ["P9TX-05", "not a connection URL"],
]) {
  test(`${id} rejects an unsafe production target before any spawn`, () => {
    assert.throws(() => parseP9Connection({ mode: "PRODUCTION", dsn }), /P9_TARGET_VALIDATION_FAILED/);
  });
}

test("P9TX-27 derives exactly four hash-bound query units from the frozen P8 packet", async () => {
  const packet = await readFile(packetPath, "utf8");
  assert.equal(createHash("sha256").update(packet).digest("hex").toUpperCase(), P9_PACKET_SHA256);
  const units = loadFrozenPacketUnits({ packet });
  assert.deepEqual(units.map((unit) => unit.queryId), ["MIGRATION_HISTORY", "SCHEMA_OBJECTS", "POLICIES_RLS", "FUNCTIONS"]);
  assert(units.every((unit) => /^[A-F0-9]{64}$/.test(unit.sourceHash)));
});

test("P9TX-28 refuses a packet whose frozen hash does not match", () => {
  assert.throws(() => loadFrozenPacketUnits({ packet: "SELECT 1;" }), /P9_PACKET_HASH_MISMATCH/);
});

test("P9TX-09 through P9TX-17 preserve each independently framed result, including zero rows", () => {
  const protocol = { nonce: "9bdea1a5cf8b44f796db910e0c5845af" };
  const units = [
    { queryId: "MIGRATION_HISTORY", sql: "SELECT 1 AS one;", sourceHash: "A".repeat(64) },
    { queryId: "SCHEMA_OBJECTS", sql: "SELECT 1 AS value UNION ALL SELECT 2;", sourceHash: "B".repeat(64) },
    { queryId: "POLICIES_RLS", sql: "SELECT 1 WHERE false;", sourceHash: "C".repeat(64) },
    { queryId: "FUNCTIONS", sql: "SELECT 'catalog' AS kind;", sourceHash: "D".repeat(64) },
  ];
  const script = createPsqlTranscript({ protocol, units });
  assert(script.indexOf("BEGIN READ ONLY;") < script.indexOf("MIGRATION_HISTORY"));
  assert.match(script, /\\set ON_ERROR_STOP on/);
  assert.match(script, /ROLLBACK;/);
  const marker = (edge, id) => `P9::${protocol.nonce}::${edge}::${id}`;
  const stdout = [
    marker("BEGIN", "SESSION"), "transaction_read_only,current_database,current_user,backend_pid", "on,postgres,postgres,9001", marker("END", "SESSION"),
    marker("BEGIN", "MIGRATION_HISTORY"), "one", "1", marker("END", "MIGRATION_HISTORY"),
    marker("BEGIN", "SCHEMA_OBJECTS"), "value", "1", "2", marker("END", "SCHEMA_OBJECTS"),
    marker("BEGIN", "POLICIES_RLS"), "policy", marker("END", "POLICIES_RLS"),
    marker("BEGIN", "FUNCTIONS"), "kind", "catalog password=fake-password token=fake-token", marker("END", "FUNCTIONS"),
    marker("BEGIN", "SESSION_FINAL"), "backend_pid", "9001", marker("END", "SESSION_FINAL"),
  ].join("\n");
  const parsed = parsePsqlTranscript({ stdout, protocol, units });
  assert.equal(parsed.transactionReadOnlyValue, "on");
  assert.equal(parsed.backendPid, "9001");
  assert.equal(parsed.sameSession, true);
  assert.deepEqual(parsed.queries.map((query) => [query.queryId, query.rowCount]), [["MIGRATION_HISTORY", 1], ["SCHEMA_OBJECTS", 2], ["POLICIES_RLS", 0], ["FUNCTIONS", 1]]);
  assert.equal(parsed.queries.find((query) => query.queryId === "POLICIES_RLS")?.completed, true);
  assert.equal(JSON.stringify(parsed).includes("fake-password"), false);
  assert.equal(JSON.stringify(parsed).includes("fake-token"), false);
});

test("P9TX-18 treats a missing framed packet result as a failure", () => {
  const protocol = { nonce: "9bdea1a5cf8b44f796db910e0c5845af" };
  const units = [{ queryId: "MIGRATION_HISTORY", sql: "SELECT 1;", sourceHash: "A".repeat(64) }];
  assert.throws(() => parsePsqlTranscript({ stdout: "", protocol, units }), /P9_RESULT_PRESERVATION_FAILURE/);
});

test("P9TX-29 rejects the consumed management API rows-empty shape", () => {
  assert.deepEqual(classifyLegacyManagementResult({ rows: [] }), {
    accepted: false,
    classification: "TRANSPORT_RESULT_PRESERVATION_FAILURE",
  });
});

test("P9TX-24 through P9TX-26 do not serialize test credentials in safe target evidence", () => {
  const parsed = parseP9Connection({ mode: "PRODUCTION", dsn: productionDsn });
  const evidence = JSON.stringify(parsed.safeTarget);
  for (const secret of ["fake-password", "fake-token", "postgresql://"]) assert.equal(evidence.includes(secret), false);
});

test("P9TX-06 through P9TX-08 invoke one shell-free psql process with credential-free argv", async () => {
  const packet = await readFile(packetPath, "utf8"); let spawnCount = 0; let observedArgs; let observedOptions;
  const spawnImpl = (_executable, args, options) => {
    spawnCount += 1; observedArgs = args; observedOptions = options;
    const child = new EventEmitter(); child.pid = 1234; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { end() { queueMicrotask(() => child.emit("close", 1)); } };
    return child;
  };
  const result = await runP9ReadOnlyCapture({ mode: "PRODUCTION", dsn: productionDsn, packet, spawnImpl, nonce: "9bdea1a5cf8b44f796db910e0c5845af" });
  assert.equal(spawnCount, 1);
  assert.equal(observedOptions.shell, false);
  assert.equal(observedArgs.some((value) => value.includes("fake-password") || value.includes("postgresql://")), false);
  assert.equal(result.rollbackMode, "CONNECTION_CLOSE_ROLLBACK");
  assert.equal(result.queriesExecuted, undefined);
  assert.equal(result.productionConnections, 1);
  assert.equal(result.productionSqlRequests, 1);
});

test("P9TX-12 rejects an observed non-read-only transaction", () => {
  const protocol = { nonce: "9bdea1a5cf8b44f796db910e0c5845af" }; const units = [{ queryId: "MIGRATION_HISTORY", sql: "SELECT 1;", sourceHash: "A".repeat(64) }];
  const marker = (edge, id) => `P9::${protocol.nonce}::${edge}::${id}`;
  const stdout = [marker("BEGIN", "SESSION"), "transaction_read_only,current_database,current_user,backend_pid", "off,postgres,postgres,9001", marker("END", "SESSION"), marker("BEGIN", "SESSION_FINAL"), "backend_pid", "9001", marker("END", "SESSION_FINAL")].join("\n");
  assert.throws(() => parsePsqlTranscript({ stdout, protocol, units }), /P9_SESSION_PROOF_FAILURE/);
});

test("P9TX-30 refuses production mode before a connection when its secure credential is absent", () => {
  const { P9_PRODUCTION_DATABASE_URL: _ignored, ...safeEnv } = process.env;
  const child = spawnSync(process.execPath, ["scripts/qa/p9-readonly-postgres-transport.mjs"], { cwd: root, env: safeEnv, encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(`${child.stdout}${child.stderr}`, /P9_PRODUCTION_CREDENTIAL_UNAVAILABLE/);
});
