import { createHash } from "node:crypto";

export const LEGAL_LOCAL_EXECUTION_APPROVAL_SCHEMA = "r6-legal-local-execution-approval-contract-v1";
const TASK_ID = /^r6-local-predeployment-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const COMMIT = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256, mode = "EXECUTE", issuedAt }) {
  const taskMatch = TASK_ID.exec(String(taskId ?? ""));
  if (!taskMatch || !COMMIT.test(String(implementationCommit ?? "")) || !HASH.test(String(migrationInventorySha256 ?? "")) || mode !== "EXECUTE") {
    fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  }
  const taskUuid = taskMatch[1];
  const requiredConfirmationPhrase = `CONFIRM_R6_LOCAL_PREDEPLOYMENT_EXECUTE_${implementationCommit.toUpperCase()}_TASK_${taskUuid.toUpperCase().replaceAll("-", "_")}_INVENTORY_${migrationInventorySha256.toUpperCase()}_SINGLE_USE`;
  return Object.freeze({
    schemaVersion: LEGAL_LOCAL_EXECUTION_APPROVAL_SCHEMA,
    implementationCommit,
    taskId,
    taskUuid,
    mode,
    migrationInventorySha256,
    requiredConfirmationPhrase,
    requiredConfirmationSha256: sha256Utf8(requiredConfirmationPhrase),
    singleUse: true,
    issuedAt,
  });
}
