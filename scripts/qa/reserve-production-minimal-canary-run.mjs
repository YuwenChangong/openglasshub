import { assertRunIdNotConsumed, finalizeReservationReceipt, reserveConsumedRun } from "./production-minimal-canary-consumed-run-registry.mjs";
import { readFile } from "node:fs/promises";
import { createReceiptAuthorizationBinding, validateDryRunAuthorization } from "./r6-final-canary-execution-contract.mjs";
import { validateCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; }
const root = option("--registry-root"); const runId = option("--run-id");
if (!root || !runId) throw new Error("QA_CANARY_CONSUMED_RUN_CLI_ARGUMENTS_INVALID");
if (process.argv.includes("--verify")) {
  console.log(JSON.stringify(await assertRunIdNotConsumed({ root, runId })));
} else if (process.argv.includes("--finalize")) {
  console.log(JSON.stringify(await finalizeReservationReceipt({
    root,
    runId,
    receiptPath: option("--receipt-path"),
    receiptSha256: option("--receipt-sha256"),
    invocationNonce: option("--invocation-nonce"),
    mode: option("--mode"),
    runnerCommit: option("--runner-commit"),
    finalState: option("--final-state"),
    actualMutationCount: Number(option("--actual-mutation-count")),
    unexpectedMutationCount: Number(option("--unexpected-mutation-count") ?? 0),
  })));
} else {
  const bindingPath = option("--final-authorization-binding");
  const targetBindingPath = option("--target-binding");
  const attestationSha256 = option("--attestation-sha256");
  const finalAuthorizationBinding = bindingPath
    ? createReceiptAuthorizationBinding(
      validateDryRunAuthorization(JSON.parse(await readFile(bindingPath, "utf8")), { productionRunId: runId, executionCommit: option("--runner-commit"), toolingCommit: option("--runner-commit") }),
      { productionRunId: runId, attestationSha256, executionCommit: option("--runner-commit") },
    )
    : undefined;
  const targetBinding = targetBindingPath ? validateCanonicalCanaryTargetBinding(JSON.parse(await readFile(targetBindingPath, "utf8")), { executionCommit: option("--runner-commit"), toolingCommit: option("--runner-commit") }) : undefined;
  const result = await reserveConsumedRun({ root, runId, mode: option("--mode"), confirmationTokenSha256: option("--confirmation-token-sha256"), runnerCommit: option("--runner-commit"), wrapperVersion: option("--wrapper-version"), wrapperSha256: option("--wrapper-sha256"), childCommandDigest: option("--child-command-digest"), ...(option("--invocation-nonce") ? { nonce: option("--invocation-nonce") } : {}), finalAuthorizationBinding, targetBinding });
  console.log(JSON.stringify(result));
}
