import {
  printQaWriteGuardError,
  readQaWriteGuardConfig,
  validateQaWriteTarget,
} from "./qa/target-write-guard.mjs";

function parseArgs(argv) {
  const options = { confirmRun: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] ?? "");
    if (value === "--confirm-run") {
      options.confirmRun = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = validateQaWriteTarget(readQaWriteGuardConfig(process.env, options.confirmRun));
    console.log(JSON.stringify({ ok: true, targetRef: result.actualRef, productionTarget: result.productionTarget, runLabel: result.safeRunLabel }, null, 2));
  } catch (error) {
    printQaWriteGuardError(error);
    process.exitCode = 1;
  }
}

main();
