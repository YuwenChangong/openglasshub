import { assertRunIdNotConsumed, reserveConsumedRun } from "./production-minimal-canary-consumed-run-registry.mjs";

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; }
const root = option("--registry-root"); const runId = option("--run-id");
if (!root || !runId) throw new Error("QA_CANARY_CONSUMED_RUN_CLI_ARGUMENTS_INVALID");
if (process.argv.includes("--verify")) {
  console.log(JSON.stringify(await assertRunIdNotConsumed({ root, runId })));
} else {
  const result = await reserveConsumedRun({ root, runId, mode: option("--mode"), confirmationTokenSha256: option("--confirmation-token-sha256"), runnerCommit: option("--runner-commit"), wrapperVersion: option("--wrapper-version"), wrapperSha256: option("--wrapper-sha256"), childCommandDigest: option("--child-command-digest") });
  console.log(JSON.stringify(result));
}
