import {
  printQaWriteGuardError,
  readConfirmRunArgument,
  readQaWriteGuardConfig,
  validateConfirmRun,
  validateQaWriteTarget,
} from "./target-write-guard.mjs";
import { createRunManifest, serializeManifest } from "./destructive-qa-orchestrator.mjs";

function parseArgs(argv) {
  const count = (flag) => argv.filter((value) => value === flag).length;
  if (count("--dry-run") > 1 || count("--execute-destructive-qa") > 1) throw new Error("QA_ORCHESTRATOR_DUPLICATE_FLAG");
  const dryRun = argv.includes("--dry-run");
  const execute = argv.includes("--execute-destructive-qa");
  if (dryRun && execute) throw new Error("QA_ORCHESTRATOR_MODE_CONFLICT");
  return { dryRun: dryRun || !execute, execute, confirmRun: readConfirmRunArgument(argv) };
}

function fail(error) {
  if (error?.code) printQaWriteGuardError(error);
  else console.error(`QA_ORCHESTRATOR_FAILED: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runId = validateConfirmRun(options.confirmRun);
    const target = validateQaWriteTarget(readQaWriteGuardConfig(process.env, runId));
    const manifest = createRunManifest({ runId, targetClassification: target.productionTarget ? "production" : "staging" });

    if (options.dryRun) {
      console.log(JSON.stringify({ phase: "PLAN", dryRun: true, targetRef: target.actualRef, targetClassification: manifest.targetClassification, runLabel: runId, plannedOperations: ["exact-ID artifact creation", "finally cleanup", "exact residue verification"] }, null, 2));
      return;
    }

    console.log(JSON.stringify({ phase: "EXECUTION", runLabel: runId, targetClassification: manifest.targetClassification }, null, 2));
    throw new Error("QA_ORCHESTRATOR_REAL_ADAPTER_NOT_CONFIGURED");
  } catch (error) {
    fail(error);
  }
}

main();
