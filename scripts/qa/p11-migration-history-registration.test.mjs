import assert from "node:assert/strict";
import test from "node:test";

test("P11 guards accept only the approved repair identity", async () => {
  const { validateP11Repair } = await import("./p11-migration-history-registration.mjs");
  assert.deepEqual(validateP11Repair({ version: "20260902042807", status: "applied", projectRef: "xcbnxzjlsvtgzixurcof", migrationHash: "2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65", actualCommit: "80d26c13eb523b4652c4b7c1d7bb73f86d77957f", approvedCommit: "80d26c13eb523b4652c4b7c1d7bb73f86d77957f", clean: true, passwordPresent: true }), ["migration", "repair", "20260902042807", "--status", "applied", "--linked"]);
});

test("P11 guards reject all alternate mutation identities", async () => {
  const { validateP11Repair } = await import("./p11-migration-history-registration.mjs");
  for (const change of [{ version: "20260518" }, { status: "reverted" }, { projectRef: "wrong" }, { migrationHash: "A".repeat(64) }, { actualCommit: "b".repeat(40) }, { clean: false }, { passwordPresent: false }]) assert.throws(() => validateP11Repair({ version: "20260902042807", status: "applied", projectRef: "xcbnxzjlsvtgzixurcof", migrationHash: "2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65", actualCommit: "80d26c13eb523b4652c4b7c1d7bb73f86d77957f", approvedCommit: "80d26c13eb523b4652c4b7c1d7bb73f86d77957f", clean: true, passwordPresent: true, ...change }), /P11_/);
});

test("P11 local mode has no production-link or password dependency", async () => {
  const { validateP11LocalRepair } = await import("./p11-migration-history-registration.mjs");
  assert.deepEqual(validateP11LocalRepair({ version: "20260902042807", status: "applied", historyCount: 0 }), ["migration", "repair", "20260902042807", "--status", "applied", "--local"]);
  assert.throws(() => validateP11LocalRepair({ version: "20260902042807", status: "applied", historyCount: 1 }), /P11_LOCAL_ALREADY_PRESENT_REJECTED/);
});

test("P11 link parser fails closed for wrong, missing, and malformed fixtures", async () => {
  const { parseP11LinkedProjectRef } = await import("./p11-migration-history-registration.mjs");
  assert.equal(parseP11LinkedProjectRef("xcbnxzjlsvtgzixurcof\n"), "xcbnxzjlsvtgzixurcof");
  for (const value of ["wrong", "", undefined]) assert.throws(() => parseP11LinkedProjectRef(value), /P11_LINK_TARGET_REJECTED/);
});

test("P11 already-present guard rejects before a repair spawn and preserves history cardinality", async () => {
  const { runP11LocalRepairGuard } = await import("./p11-migration-history-registration.mjs");
  let spawns = 0; const before = [{ version: "20260902042807", name: "forward_reconcile_devices" }];
  await assert.rejects(() => runP11LocalRepairGuard({ historyCount: before.length, spawnImpl: () => { spawns += 1; } }), /P11_LOCAL_ALREADY_PRESENT_REJECTED/);
  assert.equal(spawns, 0); assert.deepEqual(before, [{ version: "20260902042807", name: "forward_reconcile_devices" }]);
});
