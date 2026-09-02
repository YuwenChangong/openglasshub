import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { P11_MIGRATION_SHA256 } from "./p11-migration-history-registration.mjs";

const valid = { actualCommit: "a".repeat(40), approvedCommit: "a".repeat(40), clean: true, migrationHash: P11_MIGRATION_SHA256, linkRef: "xcbnxzjlsvtgzixurcof", cliVersion: "2.115.0", passwordPresent: true };

test("P11EXEC-01 uses one exact secret-free linked repair spawn", async () => {
  const { runP11ProductionRepair } = await import("./p11-production-history-registration.mjs"); let calls = [];
  const spawnImpl = (exe, argv, options) => { calls.push({ exe, argv, options }); const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); queueMicrotask(() => child.emit("close", 0)); return child; };
  const result = await runP11ProductionRepair({ ...valid, executable: "C:/repo/node_modules/@Supabase/cli-windows-x64/bin/supabase.exe", spawnImpl });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].argv, ["migration", "repair", "20260902042807", "--status", "applied", "--linked"]); assert.equal(calls[0].options.shell, false); assert.equal(calls[0].argv.some((v) => /password|secret/i.test(v)), false); assert.equal(result.productionMigrationHistoryMutations, 1);
});

test("P11EXEC-02 rejects bad preconditions before spawn and never retries failures", async () => {
  const { runP11ProductionRepair } = await import("./p11-production-history-registration.mjs"); let calls = 0;
  await assert.rejects(() => runP11ProductionRepair({ ...valid, linkRef: "wrong", executable: "x", spawnImpl: () => { calls += 1; } }), /P11_LINK_TARGET_REJECTED/); assert.equal(calls, 0);
  const spawnImpl = () => { calls += 1; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); queueMicrotask(() => child.emit("close", 7)); return child; };
  const result = await runP11ProductionRepair({ ...valid, executable: "x", spawnImpl }); assert.equal(calls, 1); assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(result.retryAllowed, false);
});
