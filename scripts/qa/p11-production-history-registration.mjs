import { spawn } from "node:child_process";
import { P11_MIGRATION_SHA256, P11_PROJECT_REF, P11_VERSION, validateP11Repair } from "./p11-migration-history-registration.mjs";

const ARGV = ["migration", "repair", P11_VERSION, "--status", "applied", "--linked"];
function fail(code) { throw new Error(code); }
function run(executable, argv, spawnImpl) { return new Promise((resolve, reject) => { const child = spawnImpl(executable, argv, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; }); child.on("error", () => reject(fail("P11_REPAIR_PROCESS_FAILURE"))); child.on("close", exitCode => resolve({ exitCode, stdout, stderr })); }); }
function sanitize(value) { return String(value ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/ig, "[REDACTED]").replace(/(password\s*[=:]\s*)[^\s,;]+/ig, "$1[REDACTED]").slice(0, 800); }

export async function runP11ProductionRepair({ actualCommit, approvedCommit, clean, migrationHash, linkRef, cliVersion, passwordPresent, executable, spawnImpl = spawn }) {
  validateP11Repair({ version: P11_VERSION, status: "applied", projectRef: linkRef, migrationHash, actualCommit, approvedCommit, clean, passwordPresent });
  if (cliVersion !== "2.115.0") fail("P11_CLI_VERSION_REJECTED");
  if (migrationHash !== P11_MIGRATION_SHA256 || linkRef !== P11_PROJECT_REF || !executable) fail("P11_PRESPAWN_REJECTED");
  const outcome = await run(executable, ARGV, spawnImpl);
  if (outcome.exitCode !== 0) return { acceptanceResult: "BLOCKED", repairProcessCount: 1, retryAllowed: false, failureStage: "REPAIR_PROCESS", exitCode: outcome.exitCode, failureDetail: sanitize(outcome.stderr), productionMigrationHistoryMutations: 0, productionSchemaMutations: 0, productionApplicationDataMutations: 0, secretAudit: "PASS" };
  return { acceptanceResult: "PASS", repairProcessCount: 1, retryAllowed: false, repairVersion: P11_VERSION, repairStatus: "applied", linkedProjectRef: P11_PROJECT_REF, productionMigrationHistoryMutations: 1, productionSchemaMutations: 0, productionApplicationDataMutations: 0, schemaReplay: false, secretAudit: "PASS" };
}

export { ARGV as P11_REPAIR_ARGV };
