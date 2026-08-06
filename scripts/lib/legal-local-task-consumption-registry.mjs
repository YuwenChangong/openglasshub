import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "./legal-local-replay-evidence.mjs";

export const LEGAL_LOCAL_TASK_CONSUMPTION_SCHEMA = "r6-legal-local-task-consumption-v1";
const HISTORICALLY_CONSUMED = new Set(["r6-local-predeployment-fc1a4df7-b1aa-4c5b-8347-fe16b423cf67"]);
const fail = (code, innerClassification) => { throw Object.assign(new Error(code), { code, innerClassification }); };

function entryPath(registryRoot, taskId) {
  if (!/^r6-local-predeployment-[a-f0-9-]+$/.test(String(taskId ?? ""))) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", "LEGAL_LOCAL_EXECUTION_TASK_INVALID");
  return path.join(path.resolve(registryRoot), `${taskId}.json`);
}

export async function consumeLegalLocalExecuteTask({ registryRoot, approvalContract, now = () => new Date().toISOString() }) {
  if (HISTORICALLY_CONSUMED.has(approvalContract.taskId)) {
    fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", "LEGAL_LOCAL_EXECUTION_TASK_ALREADY_CONSUMED");
  }
  const destination = entryPath(registryRoot, approvalContract.taskId);
  try {
    await access(destination);
    fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", "LEGAL_LOCAL_EXECUTION_TASK_ALREADY_CONSUMED");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const payload = {
    schemaVersion: LEGAL_LOCAL_TASK_CONSUMPTION_SCHEMA,
    taskId: approvalContract.taskId,
    implementationCommit: approvalContract.implementationCommit,
    migrationInventorySha256: approvalContract.migrationInventorySha256,
    mode: approvalContract.mode,
    confirmationSha256: approvalContract.requiredConfirmationSha256,
    status: "EXECUTE_ATTEMPT_CONSUMED",
    consumedAt: now(),
  };
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${stableJson(payload)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if (error?.code === "EEXIST") fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", "LEGAL_LOCAL_EXECUTION_TASK_ALREADY_CONSUMED");
    throw error;
  }
  return Object.freeze({ path: destination, status: payload.status });
}
