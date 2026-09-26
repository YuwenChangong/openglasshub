import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prepareAuthADbPacket, runAuthADbCapture } from "./verified-session-auth-a-db-capture.mjs";

const catalog = readFileSync("docs/ops/verified-session-v1-hosted-catalog-preflight.sql", "utf8");
const history = readFileSync("docs/ops/p9-migration-history-rows-read-only.sql", "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const dsn = "postgresql://postgres:local-only@127.0.0.1:5432/postgres";
const nonce = "a".repeat(32);

function mockPsql({ failAt = null, secret = "" } = {}) {
  let spawns = 0; let transcript = "";
  const spawnImpl = (_executable, args, options) => {
    spawns += 1;
    assert.deepEqual(args, ["-X", "-q", "-v", "ON_ERROR_STOP=1"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.pid = 4321; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end(input) {
      transcript = input;
      queueMicrotask(() => {
        const ids = ["CATALOG_01", "CATALOG_02", "CATALOG_03", "CATALOG_04", "CATALOG_05",
          "CATALOG_06", "CATALOG_07", "CATALOG_08", "CATALOG_09", "CATALOG_10", "CATALOG_11", "HISTORY_01"];
        const frame = (id, rows) => [`P9::${nonce}::BEGIN::${id}`, ...rows, `P9::${nonce}::END::${id}`];
        const lines = frame("SESSION", ["transaction_read_only,current_database,current_user,backend_pid", "on,postgres,postgres,777"]);
        for (const id of ids) {
          if (id === failAt) { lines.push(`P9::${nonce}::BEGIN::${id}`); break; }
          lines.push(...frame(id, ["fact", secret ? `\"${secret}\"` : ""].filter(Boolean)));
        }
        if (!failAt) lines.push(...frame("SESSION_FINAL", ["backend_pid", "777"]));
        child.stdout.emit("data", lines.join("\n"));
        if (failAt) child.stderr.emit("data", "ERROR: local test failure");
        child.emit("close", failAt ? 1 : 0);
      });
    } };
    return child;
  };
  return { spawnImpl, get spawns() { return spawns; }, get transcript() { return transcript; } };
}

test("DB-01..04 exact independent hashes and SELECT-only units fail before spawn", () => {
  const prepared = prepareAuthADbPacket({ catalog, history });
  assert.equal(prepared.catalogSha256, sha(catalog));
  assert.equal(prepared.historySha256, sha(history));
  assert.equal(prepared.queryIds.length, 12);
  assert.deepEqual(prepared.queryIds.slice(-1), ["HISTORY_01"]);
  for (const input of [
    { catalog: catalog + " ", history }, { catalog, history: history + " " },
    { catalog: catalog.replace(/select/i, "DELETE"), history },
    { catalog, history: history.replace(/SELECT/i, "UPDATE") },
  ]) assert.throws(() => prepareAuthADbPacket(input), /AUTH_A_DB_PACKET_/);
});

test("DB-05..09 one read-only transcript, one backend PID/process and explicit rollback", async () => {
  const mock = mockPsql();
  const result = await runAuthADbCapture({ mode: "LOCAL_TEST", dsn, catalog, history,
    spawnImpl: mock.spawnImpl, nonce });
  assert.equal(result.status, "PASS");
  assert.equal(mock.spawns, 1);
  assert.equal(result.connectionAttempts, 1);
  assert.equal(result.sameBackend, true);
  assert.equal(result.transactionReadOnly, true);
  assert.equal(result.queryCount, 12);
  assert.equal(result.rollbackMode, "EXPLICIT_ROLLBACK");
  assert.match(mock.transcript, /BEGIN READ ONLY;/);
  assert.match(mock.transcript, /ROLLBACK;/);
  assert.ok(mock.transcript.indexOf("CATALOG_11") < mock.transcript.indexOf("HISTORY_01"));
});

test("DB-10..12 first/second packet failure closes without a reconnect", async () => {
  for (const failAt of ["CATALOG_01", "HISTORY_01"]) {
    const mock = mockPsql({ failAt });
    const result = await runAuthADbCapture({ mode: "LOCAL_TEST", dsn, catalog, history,
      spawnImpl: mock.spawnImpl, nonce });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.firstFailureQueryId, failAt);
    assert.equal(mock.spawns, 1);
    assert.equal(result.connectionAttempts, 1);
    assert.equal(result.rollbackMode, "CONNECTION_CLOSE_ROLLBACK");
  }
});

test("DB-13 wrong target fails before spawn; DB-14 shared evidence omits secrets", async () => {
  const mock = mockPsql({ secret: "fake-password" });
  await assert.rejects(runAuthADbCapture({ mode: "PRODUCTION", dsn: "postgresql://postgres:fake-password@wrong.invalid/postgres",
    catalog, history, spawnImpl: mock.spawnImpl, nonce }), /P9_TARGET_VALIDATION_FAILED/);
  assert.equal(mock.spawns, 0);
  const result = await runAuthADbCapture({ mode: "LOCAL_TEST", dsn, catalog, history,
    spawnImpl: mock.spawnImpl, nonce });
  assert.equal(JSON.stringify(result).includes("fake-password"), false);
  assert.equal(JSON.stringify(result).includes("local-only"), false);
});
