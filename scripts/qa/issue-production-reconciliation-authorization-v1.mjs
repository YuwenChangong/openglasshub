import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueCurrentProductionAuthorizationV1 } from "../lib/r6-production-reconciliation-authorization-orchestrator-v1.mjs";

const usage = "Usage: node scripts/qa/issue-production-reconciliation-authorization-v1.mjs --package-root <absolute-path> --candidate-root <absolute-path> --execution-binding-output <absolute-path>";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !value || !key.startsWith("--") || values.has(key)) {
      throw new Error("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID");
    }
    values.set(key, value);
  }
  if (values.size !== 3 || !values.has("--package-root") || !values.has("--candidate-root") || !values.has("--execution-binding-output")) {
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
  });
  console.log(JSON.stringify({
    classification: result.classification,
    sourceCommit: result.sourceCommit,
    packageRoot: result.packageIssued.packageRoot,
    candidateRoot: result.candidateIssued.candidateRoot,
    executionBindingPath: result.executionBinding.path,
    executionBindingSha256: result.executionBinding.sha256,
    confirmationPhrase: result.confirmationIssued.confirmationPhrase,
    confirmationPhraseSha256: result.confirmation.value.confirmationPhraseSha256,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_FAILED");
    process.exitCode = 1;
  });
}

export { parseArguments };
