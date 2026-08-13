import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { advancePostConfirmationToExecuteV2 } from "../lib/r6-production-reconciliation-post-confirmation-orchestrator-v1.mjs";

const usage = "Usage: node scripts/qa/advance-production-reconciliation-post-confirmation-v1.mjs --package-root <absolute-path> --candidate-root <absolute-path> --confirmation-stdin [--test-only --test-authority-root <absolute-path> [--test-failure-stage <global-claim|final-persistence|execute-persistence>]]";

export function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length;) {
    const key = argv[index];
    if (key === "--confirmation-stdin" || key === "--test-only") { if (values.has(key)) throw new Error("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_CLI_ARGUMENT_INVALID"); values.set(key, true); index += 1; continue; }
    const value = argv[index + 1];
    if (!key || !value || !key.startsWith("--") || values.has(key)) throw new Error("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_CLI_ARGUMENT_INVALID");
    values.set(key, value); index += 2;
  }
  const testOnly = values.get("--test-only") === true;
  if (!values.has("--package-root") || !values.has("--candidate-root") || values.get("--confirmation-stdin") !== true || (testOnly !== values.has("--test-authority-root")) || (!testOnly && values.has("--test-failure-stage"))) throw new Error("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_CLI_ARGUMENT_INVALID");
  return Object.fromEntries(values);
}

async function readExactPhrase() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (process.argv.includes("--help")) { console.log(usage); return; }
  const arguments_ = parseArguments(process.argv.slice(2));
  const confirmationPhrase = await readExactPhrase();
  const testOnly = arguments_["--test-only"] === true;
  const sqlClientCapability = testOnly ? { executablePath: "C:\\offline\\psql.exe", executableSha256: createHash("sha256").update("post-confirmation-test-psql").digest("hex"), version: "offline", help: "offline" } : undefined;
  const result = await advancePostConfirmationToExecuteV2({
    repositoryRoot: process.cwd(), packageRoot: path.resolve(arguments_["--package-root"]), candidateRoot: path.resolve(arguments_["--candidate-root"]), confirmationPhrase,
    sqlClientCapability, testOnly, testAuthorityRoot: arguments_["--test-authority-root"] && path.resolve(arguments_["--test-authority-root"]), testFailureStage: arguments_["--test-failure-stage"],
  });
  console.log(JSON.stringify({ classification: result.classification, sourceCommit: result.sourceCommit, confirmationPhraseSha256: result.confirmationPhraseSha256, globalClaimSha256: result.globalClaimSha256, finalV5Sha256: result.finalConfirmationSha256, executeV2Sha256: result.executeApprovalSha256, executionBindingV2Sha256: result.executionBinding.sha256, expectedProjectRef: result.route.projectRef, materializationV2: 0, ready: 0, productionOperations: 0 }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error?.code ?? error?.message ?? "R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_CLI_FAILED"}\n`); process.exitCode = 1; });
