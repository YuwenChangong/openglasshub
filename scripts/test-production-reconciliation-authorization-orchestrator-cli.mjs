import assert from "node:assert/strict";
import { parseArguments } from "./qa/issue-production-reconciliation-authorization-v1.mjs";

const parsed = parseArguments([
  "--package-root", "C:\\temp\\package",
  "--candidate-root", "C:\\temp\\candidate",
  "--execution-binding-output", "C:\\temp\\candidate\\execution-binding-v2.json",
]);
assert.equal(parsed["--package-root"], "C:\\temp\\package");
assert.throws(() => parseArguments(["--package-root", "C:\\temp\\package"]), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID/);
assert.throws(() => parseArguments(["--package-root", "C:\\temp\\package", "--package-root", "C:\\temp\\second", "--candidate-root", "C:\\temp\\candidate", "--execution-binding-output", "C:\\temp\\candidate\\execution-binding-v2.json"]), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID/);

console.log("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_CONTRACT_PASS");
