import {
  printQaWriteGuardError,
  readConfirmRunArgument,
  readQaWriteGuardConfig,
  validateQaWriteTarget,
} from "./qa/target-write-guard.mjs";

function main() {
  try {
    const confirmRun = readConfirmRunArgument(process.argv.slice(2));
    const result = validateQaWriteTarget(readQaWriteGuardConfig(process.env, confirmRun));
    console.log(JSON.stringify({ ok: true, targetRef: result.actualRef, productionTarget: result.productionTarget, runLabel: result.safeRunLabel }, null, 2));
  } catch (error) {
    printQaWriteGuardError(error);
    process.exitCode = 1;
  }
}

main();
