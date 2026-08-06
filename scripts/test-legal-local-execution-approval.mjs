import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createLegalLocalExecutionApproval, sha256Utf8 } from "./lib/legal-local-execution-approval.mjs";

const base = { implementationCommit: "5b9e29ddcd2d53cfe00033fe9999ac6f2eb4ff94", taskId: "r6-local-predeployment-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", migrationInventorySha256: "3d801ed1f10d84ccfb0f8ee2ee73e81a90e0a2b3955f75c4e91ed98c1520350a", issuedAt: "2026-08-06T00:00:00.000Z" };
const contract = createLegalLocalExecutionApproval(base);
assert.equal(contract.schemaVersion, "r6-legal-local-execution-approval-contract-v1");
assert.equal(contract.requiredConfirmationSha256, sha256Utf8(contract.requiredConfirmationPhrase));
assert.deepEqual(createLegalLocalExecutionApproval(base), contract);
assert.notEqual(createLegalLocalExecutionApproval({ ...base, taskId: "r6-local-predeployment-aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff" }).requiredConfirmationPhrase, contract.requiredConfirmationPhrase);
assert.notEqual(createLegalLocalExecutionApproval({ ...base, implementationCommit: "d397a27e389b4ca65599a8be8c73894b3f958fa8" }).requiredConfirmationPhrase, contract.requiredConfirmationPhrase);
assert.notEqual(createLegalLocalExecutionApproval({ ...base, migrationInventorySha256: "4d801ed1f10d84ccfb0f8ee2ee73e81a90e0a2b3955f75c4e91ed98c1520350a" }).requiredConfirmationPhrase, contract.requiredConfirmationPhrase);
for (const value of [contract.requiredConfirmationPhrase.toLowerCase(), ` ${contract.requiredConfirmationPhrase}`, `${contract.requiredConfirmationPhrase}\n`]) assert.notEqual(value, contract.requiredConfirmationPhrase);
const preflight = JSON.parse(execFileSync(process.execPath, ["scripts/qa/run-legal-local-predeployment-replay.mjs", "--mode", "PREFLIGHT", "--task-id", base.taskId], { cwd: process.cwd(), encoding: "utf8" }));
assert.equal(preflight.classification, "R6_LOCAL_NONPRODUCTION_PREFLIGHT_READY");
assert.deepEqual(preflight.approvalContract, createLegalLocalExecutionApproval({ ...base, issuedAt: preflight.approvalContract.issuedAt }));
console.log(JSON.stringify({ classification: "R6_LEGAL_LOCAL_EXECUTION_APPROVAL_CONTRACT_TESTS_READY", scenarios: 8, realOperations: 0 }));
