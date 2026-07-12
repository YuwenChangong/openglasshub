import { loadRecoveryManifest } from "./recovery-manifest.mjs";
import { printQaWriteGuardError, readConfirmRunArgument, readQaWriteGuardConfig, validateConfirmRun, validateQaWriteTarget } from "./target-write-guard.mjs";

function main() {
  const args = process.argv.slice(2); const index = args.indexOf("--manifest"); const manifestPath = index >= 0 ? args[index + 1] : null;
  try {
    if (!manifestPath || args.filter((x) => x === "--manifest").length !== 1) throw new Error("QA_RECOVERY_MANIFEST_REQUIRED");
    const execute = args.includes("--execute-recovery"); const dry = args.includes("--dry-run") || !execute;
    if (execute && args.includes("--dry-run")) throw new Error("QA_RECOVERY_MODE_CONFLICT");
    const runId = validateConfirmRun(readConfirmRunArgument(args));
    const manifest = loadRecoveryManifest(manifestPath);
    if (manifest.runId !== runId) throw new Error("QA_RECOVERY_RUN_ID_MISMATCH");
    const target = validateQaWriteTarget(readQaWriteGuardConfig(process.env, runId));
    if (manifest.targetBinding?.projectRef !== target.actualRef || manifest.targetBinding.projectRef !== target.expectedRef) throw new Error("QA_RECOVERY_TARGET_MISMATCH");
    if (target.productionTarget) throw new Error("QA_RECOVERY_PRODUCTION_REJECTED");
    if (manifest.status === "RECOVERED" && !dry) throw new Error("QA_RECOVERY_ALREADY_COMPLETE");
    if (dry) { console.log(JSON.stringify({ phase: "PLAN", runLabel: runId, artifactCounts: Object.fromEntries(Object.entries(manifest.artifacts).map(([k,v])=>[k,v.length])) }, null, 2)); return; }
    throw new Error("QA_RECOVERY_REAL_ADAPTER_NOT_CONFIGURED");
  } catch (error) { if(error?.code) printQaWriteGuardError(error); else console.error(`QA_RECOVERY_FAILED: ${error.message}`); process.exitCode=1; }
}
main();
