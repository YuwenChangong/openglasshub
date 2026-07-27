import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backfillHistoricalConsumedRuns, consumeReservationReceipt, reserveConsumedRun } from "./qa/production-minimal-canary-consumed-run-registry.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = await readFile(path.join(repositoryRoot, "scripts", "qa", "r6-detached-secure-wrapper.ps1"), "utf8");
const executionCommit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const legacyCommit = "1d558a54d07a9f425b98e9bcab501b4e644b7ef6";
const runId = "qa-canary-33333333-3333-4333-8333-333333333333";
const base = { mode: "dry-run", confirmationTokenSha256: "a".repeat(64), wrapperVersion: "r6-consumed-run-wrapper-v1", wrapperSha256: "b".repeat(64), childCommandDigest: "c".repeat(64) };

assert.match(wrapper, /function Get-ValidatedExecutionCommit\(\[pscustomobject\]\$Validation\)/);
assert.match(wrapper, /--runner-commit', \$runnerCommit/);
assert.match(wrapper, /QA_EXPECTED_RUNNER_COMMIT', \$expectedRunnerCommit/);
assert.match(wrapper, /R6_EXECUTION_COMMIT_CHANGED/);
const reserveBody = wrapper.match(/function Reserve-ConsumedRun[\s\S]*?\n}\r?\n\r?\nfunction Assert-ExecutionWorktree/)?.[0] ?? "";
assert.match(reserveBody, /Get-ValidatedExecutionCommit \$Validation/);
assert.doesNotMatch(reserveBody, /ExpectedRunnerCommit/);
assert.notEqual(executionCommit, legacyCommit, "fixture requires feature and execution commits to differ");

const root = await mkdtemp(path.join(os.tmpdir(), "r6-v3-receipt-binding-"));
try {
  const historical = path.join(root, "historical.json");
  await writeFile(historical, `${JSON.stringify({ runId: "qa-canary-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", domain: "dry-run", sha256: "d".repeat(64), recordedAt: "2026-07-27T00:00:00.000Z" })}\n`);
  await backfillHistoricalConsumedRuns({ root, records: [{ runId: "qa-canary-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceLedgerPath: historical }], now: "2026-07-27T00:00:00.000Z" });

  const reservation = await reserveConsumedRun({ root, runId, runnerCommit: executionCommit, nonce: "33333333-3333-4333-8333-333333333333", now: "2026-07-27T00:01:00.000Z", ...base });
  const receipt = JSON.parse(await readFile(reservation.receiptPath, "utf8"));
  assert.equal(receipt.runnerCommit, executionCommit, "receipt must bind the validated execution worktree HEAD");
  assert.notEqual(receipt.runnerCommit, legacyCommit, "receipt must not use the legacy wrapper binding");
  await consumeReservationReceipt({ root, runId, runnerCommit: executionCommit, receiptPath: reservation.receiptPath, receiptSha256: reservation.receiptSha256, invocationNonce: reservation.invocationNonce, ...base });

  const mismatchId = "qa-canary-44444444-4444-4444-8444-444444444444";
  const mismatch = await reserveConsumedRun({ root, runId: mismatchId, runnerCommit: legacyCommit, nonce: "44444444-4444-4444-8444-444444444444", now: "2026-07-27T00:02:00.000Z", ...base, confirmationTokenSha256: "e".repeat(64) });
  await assert.rejects(consumeReservationReceipt({ root, runId: mismatchId, runnerCommit: executionCommit, receiptPath: mismatch.receiptPath, receiptSha256: mismatch.receiptSha256, invocationNonce: mismatch.invocationNonce, ...base }), /QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH/);
  const pending = JSON.parse(await readFile(mismatch.receiptPath, "utf8"));
  assert.equal(pending.state, "PENDING", "a binding failure must not consume or repair the receipt");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("R6_V3_RECEIPT_RUNNER_COMMIT_BINDING_OK execution-worktree commit is bound exactly; legacy mismatch remains fail-closed and pending");
