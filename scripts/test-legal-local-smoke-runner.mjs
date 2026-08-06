import assert from "node:assert/strict";
import { REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS, runLegalLocalSmoke } from "./lib/legal-local-smoke-runner.mjs";

const base = { taskId: "r6-local-predeployment-11111111-2222-4333-8444-555555555555", implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2" };
const passingAdapter = { async runSmokeCheck() { return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: "PASS", classification: "READY" }; } };
const passed = await runLegalLocalSmoke({ adapter: passingAdapter, ...base });
assert.equal(passed.success, true); assert.equal(passed.checks.length, REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length);
const failed = await runLegalLocalSmoke({ adapter: { async runSmokeCheck({ check }) { return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: check === "admin-boundary" ? "FAIL" : "PASS", classification: check === "admin-boundary" ? "FAILED" : "READY" }; } }, ...base });
assert.equal(failed.success, false); assert.equal(failed.failedCheck, "admin-boundary");
console.log(JSON.stringify({ classification: "R6_LOCAL_SMOKE_RUNNER_CONTRACT_TESTS_READY", checks: REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length, realOperations: 0 }));
