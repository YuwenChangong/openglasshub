import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertRunIdNotConsumed, backfillHistoricalConsumedRuns, consumeReservationReceipt, loadConsumedRunRegistry, reserveConsumedRun, sha256 } from "./qa/production-minimal-canary-consumed-run-registry.mjs";

const ids = {
  dryOne: "qa-canary-cf466ba5-5eb1-48ba-b18c-f20b60193a07",
  liveOne: "qa-canary-e61e9405-8fab-4570-8a6b-a23a0841ac37",
  dryTwo: "qa-canary-76c5e82b-e601-4ccc-b571-b949f35c28d2",
  liveTwo: "qa-canary-60622b81-6c5f-40fd-a73b-bfb0cf559f9d",
  fresh: "qa-canary-11111111-1111-4111-8111-111111111111",
  second: "qa-canary-22222222-2222-4222-8222-222222222222",
};
const runnerCommit = "a".repeat(40); const wrapperVersion = "r6-consumed-run-wrapper-v1"; const wrapperSha = "b".repeat(64); const commandDigest = "c".repeat(64); const token = "d".repeat(64);
const now = "2026-07-18T12:00:00.000Z";

async function ledger(root, runId, domain, tokenHash) {
  const file = path.join(root, `${runId}-${domain}.json`);
  await writeFile(file, `${JSON.stringify({ sha256: tokenHash, runId, domain, recordedAt: now })}\n`);
  return file;
}
async function historical(root) {
  return [
    { runId: ids.dryOne, sourceLedgerPath: await ledger(root, ids.dryOne, "dry-run", "1".repeat(64)) },
    { runId: ids.liveOne, sourceLedgerPath: await ledger(root, ids.liveOne, "live", "2".repeat(64)) },
    { runId: ids.dryTwo, sourceLedgerPath: await ledger(root, ids.dryTwo, "dry-run", "3".repeat(64)) },
    { runId: ids.liveTwo, sourceLedgerPath: await ledger(root, ids.liveTwo, "live", "4".repeat(64)) },
    { runId: "qa-canary-d5d9eed0-a599-4cf6-be98-39e2060d2340", legacyBlock: true },
  ];
}

const root = await mkdtemp(path.join(os.tmpdir(), "qa-consumed-run-registry-"));
try {
  const records = await historical(root);
  const first = await backfillHistoricalConsumedRuns({ root, records, now });
  assert.deepEqual(new Set(first.added), new Set(records.map((record) => record.runId)));
  const registryBefore = await readFile(path.join(root, "consumed-run-registry-v1.json"));
  const ledgerBefore = await readFile(path.join(root, "confirmation-token-ledger-v1.json"));
  const second = await backfillHistoricalConsumedRuns({ root, records, now });
  assert.deepEqual(second.added, [], "historical backfill must be idempotent");
  assert.equal(sha256(await readFile(path.join(root, "consumed-run-registry-v1.json"))), sha256(registryBefore));
  assert.equal(sha256(await readFile(path.join(root, "confirmation-token-ledger-v1.json"))), sha256(ledgerBefore), "backfill must not rewrite historical token facts");

  for (const id of [ids.dryOne, ids.liveOne, ids.dryTwo, ids.liveTwo]) {
    await assert.rejects(assertRunIdNotConsumed({ root, runId: id }), /QA_CANARY_RUN_ID_ALREADY_CONSUMED/);
    await assert.rejects(reserveConsumedRun({ root, runId: id, mode: "dry-run", confirmationTokenSha256: token, runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest, now }), /QA_CANARY_RUN_ID_ALREADY_CONSUMED/);
    await assert.rejects(reserveConsumedRun({ root, runId: id, mode: "live", confirmationTokenSha256: token, runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest, now }), /QA_CANARY_RUN_ID_ALREADY_CONSUMED/);
  }

  const reservation = await reserveConsumedRun({ root, runId: ids.fresh, mode: "dry-run", confirmationTokenSha256: token, runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest, now, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  await assert.rejects(reserveConsumedRun({ root, runId: ids.fresh, mode: "live", confirmationTokenSha256: "e".repeat(64), runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest, now }), /QA_CANARY_RUN_ID_ALREADY_CONSUMED/);
  await assert.rejects(reserveConsumedRun({ root, runId: ids.second, mode: "live", confirmationTokenSha256: token, runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest, now }), /QA_CANARY_CONFIRMATION_TOKEN_REUSED/);
  await assert.rejects(consumeReservationReceipt({ root, receiptPath: reservation.receiptPath, receiptSha256: reservation.receiptSha256, invocationNonce: reservation.invocationNonce, runId: ids.fresh, mode: "live", runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest }), /BINDING_MISMATCH/);
  await assert.rejects(consumeReservationReceipt({ root, receiptPath: path.join(root, "..", "escape.json"), receiptSha256: reservation.receiptSha256, invocationNonce: reservation.invocationNonce, runId: ids.fresh, mode: "dry-run", runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest }), /PATH_INVALID/);
  await consumeReservationReceipt({ root, receiptPath: reservation.receiptPath, receiptSha256: reservation.receiptSha256, invocationNonce: reservation.invocationNonce, runId: ids.fresh, mode: "dry-run", runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest });
  await assert.rejects(consumeReservationReceipt({ root, receiptPath: reservation.receiptPath, receiptSha256: sha256(await readFile(reservation.receiptPath)), invocationNonce: reservation.invocationNonce, runId: ids.fresh, mode: "dry-run", runnerCommit, wrapperVersion, wrapperSha256: wrapperSha, childCommandDigest: commandDigest }), /RECEIPT_REPLAY/);

  const state = await loadConsumedRunRegistry({ root });
  assert.equal(state.registry.entries.length, 6);
  await writeFile(path.join(root, "consumed-run-registry-v1.json"), "{", "utf8");
  await assert.rejects(loadConsumedRunRegistry({ root }), /REGISTRY_INVALID/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PRODUCTION_MINIMAL_CANARY_CONSUMED_RUN_REGISTRY_OK historical IDs, atomic reservation, token binding, and one-shot receipts fail closed with zero network");
