import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { P9_PACKET_2_CONTRACT, runP9MigrationHistoryRowsCapture } from "./p9-migration-history-rows-capture.mjs";

const root = process.cwd();
const packetPath = path.join(root, "docs", "ops", "p9-migration-history-rows-read-only.sql");
const dsn = "postgresql://postgres:fake-password@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require";

test("P9P2-11 produces a one-query production-ready read-only execution contract", async () => {
  const packet = await readFile(packetPath, "utf8"); let input = "";
  const spawnImpl = () => {
    const child = new EventEmitter(); child.pid = 2468; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end(value) { input = value; queueMicrotask(() => child.emit("close", 1)); } };
    return child;
  };
  const evidence = await runP9MigrationHistoryRowsCapture({ mode: "PRODUCTION", dsn, packet, spawnImpl, nonce: "9bdea1a5cf8b44f796db910e0c5845af" });
  assert.deepEqual(P9_PACKET_2_CONTRACT.queryIds, ["MIGRATION_HISTORY_ROWS"]);
  assert.equal(evidence.packetHash, P9_PACKET_2_CONTRACT.packetHash);
  assert.match(input, /BEGIN READ ONLY;/);
  assert.match(input, /::BEGIN::MIGRATION_HISTORY_ROWS/);
  assert.match(input, /ROLLBACK;/);
  assert.doesNotMatch(input, /fake-password/);
});
