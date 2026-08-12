import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueCurrentProductionAuthorizationV1 } from "../lib/r6-production-reconciliation-authorization-orchestrator-v1.mjs";

const usage = "Usage: node scripts/qa/issue-production-reconciliation-authorization-v1.mjs --package-root <absolute-path> --candidate-root <absolute-path> --execution-binding-output <absolute-path> [--test-only --test-authority-root <absolute-path> [--test-failure-stage <authority-root-mismatch|binding-tamper|duplicate-hash|downstream-prerequisite>]]";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length;) {
    const key = argv[index];
    if (key === "--test-only") {
      if (values.has(key)) throw new Error("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID");
      values.set(key, true); index += 1; continue;
    }
    const value = argv[index + 1];
    if (!key || !value || !key.startsWith("--") || values.has(key)) {
      throw new Error("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID");
    }
    values.set(key, value); index += 2;
  }
  const testOnly = values.get("--test-only") === true;
  const allowed = testOnly ? 5 + (values.has("--test-failure-stage") ? 1 : 0) : 3;
  if (values.size !== allowed || !values.has("--package-root") || !values.has("--candidate-root") || !values.has("--execution-binding-output") || (testOnly !== values.has("--test-authority-root")) || (!testOnly && values.has("--test-failure-stage"))) {
    throw new Error("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID");
  }
  return Object.fromEntries(values);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(usage);
    return;
  }
  const arguments_ = parseArguments(process.argv.slice(2));
  const result = await issueCurrentProductionAuthorizationV1({
    repositoryRoot: process.cwd(),
    packageRoot: path.resolve(arguments_["--package-root"]),
    candidateRoot: path.resolve(arguments_["--candidate-root"]),
    executionBindingOutputPath: path.resolve(arguments_["--execution-binding-output"]),
    testOnly: arguments_["--test-only"] === true,
    testAuthorityRoot: arguments_["--test-authority-root"] && path.resolve(arguments_["--test-authority-root"]),
    testFailureStage: arguments_["--test-failure-stage"],
  });
  console.log(JSON.stringify({
    classification: "R6_PRODUCTION_RECONCILIATION_FINAL_RC_AUTHORIZATION_AWAITING_HUMAN_CONFIRMATION",
    sourceCommit: result.sourceCommit,
    packageRoot: result.packageIssued.packageRoot,
    candidateRoot: result.candidateIssued.candidateRoot,
    executionBindingPath: result.executionBinding.path,
    executionBindingSha256: result.executionBinding.sha256,
    confirmationPhraseSha256: result.confirmation.value.confirmationPhraseSha256,
  }));
  console.log("FRESH_CONFIRMATION_PHRASE:");
  console.log(result.confirmationIssued.confirmationPhrase);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_FAILED");
    process.exitCode = 1;
  });
}

export { parseArguments };
