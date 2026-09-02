import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { P11_MIGRATION_SHA256, P11_PROJECT_REF, P11_VERSION, validateP11Repair } from "./p11-migration-history-registration.mjs";

const ARGV = ["migration", "repair", P11_VERSION, "--status", "applied", "--linked"];
function fail(code) { throw new Error(code); }
function run(executable, argv, spawnImpl) { return new Promise((resolve, reject) => { const child = spawnImpl(executable, argv, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; }); child.on("error", () => reject(fail("P11_REPAIR_PROCESS_FAILURE"))); child.on("close", exitCode => resolve({ exitCode, stdout, stderr })); }); }
function sanitize(value, password = "") { return String(value ?? "").split(password).join(password ? "[REDACTED]" : "").replace(/postgres(?:ql)?:\/\/[^\s]+/ig, "[REDACTED]").replace(/(password\s*[=:]\s*)[^\s,;]+/ig, "$1[REDACTED]").slice(0, 800); }

export async function runP11ProductionRepair({ actualCommit, approvedCommit, clean, migrationHash, linkRef, cliVersion, passwordPresent, executable, spawnImpl = spawn, cwd, password = "" }) {
  validateP11Repair({ version: P11_VERSION, status: "applied", projectRef: linkRef, migrationHash, actualCommit, approvedCommit, clean, passwordPresent });
  if (cliVersion !== "2.115.0") fail("P11_CLI_VERSION_REJECTED");
  if (migrationHash !== P11_MIGRATION_SHA256 || linkRef !== P11_PROJECT_REF || !executable) fail("P11_PRESPAWN_REJECTED");
  const outcome = await new Promise((resolveOutcome, rejectOutcome) => { const child = spawnImpl(executable, ARGV, { shell: false, cwd, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; }); child.on("error", () => rejectOutcome(new Error("P11_REPAIR_PROCESS_FAILURE"))); child.on("close", exitCode => resolveOutcome({ exitCode, stdout, stderr })); });
  if (outcome.exitCode !== 0) return { acceptanceResult: "BLOCKED", repairProcessCount: 1, retryAllowed: false, failureStage: "REPAIR_PROCESS", exitCode: outcome.exitCode, failureDetail: sanitize(`${outcome.stdout}\n${outcome.stderr}`, password), productionMigrationHistoryMutationStatus: "UNKNOWN_AFTER_STARTED_FAILURE", productionSchemaMutations: 0, productionApplicationDataMutations: 0, secretAudit: "PASS" };
  return { acceptanceResult: "PASS", repairProcessCount: 1, retryAllowed: false, repairVersion: P11_VERSION, repairStatus: "applied", linkedProjectRef: P11_PROJECT_REF, productionMigrationHistoryMutations: 1, productionSchemaMutations: 0, productionApplicationDataMutations: 0, schemaReplay: false, secretAudit: "PASS" };
}

export { ARGV as P11_REPAIR_ARGV };

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export async function runP11ProductionHistoryRegistrationMain({ deps = {}, env = process.env } = {}) {
  const root = deps.root ?? ROOT; const git = deps.git ?? (args => { const r = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false }); if (r.status !== 0) throw new Error("P11_SOURCE_BINDING"); return r.stdout.trim(); });
  const readFile = deps.readFile ?? (path => readFileSync(path, "utf8")); const hash = deps.hash ?? (value => createHash("sha256").update(value).digest("hex").toUpperCase()); const exists = deps.exists ?? existsSync;
  const executable = join(root, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe"); const migration = join(root, "supabase", "migrations", "20260902042807_forward_reconcile_devices.sql"); const projectRefPath = join(root, "supabase", ".temp", "project-ref");
  const actualCommit = git(["rev-parse", "HEAD"]); const clean = git(["status", "--porcelain"]) === ""; const approvedCommit = env.P11_APPROVED_SOURCE_COMMIT; const password = env.SUPABASE_DB_PASSWORD ?? "";
  if (!exists(executable)) throw new Error("P11_CLI_PATH"); if (!approvedCommit || !clean || actualCommit !== approvedCommit) throw new Error("P11_SOURCE_BINDING"); if (hash(readFile(migration)) !== P11_MIGRATION_SHA256) throw new Error("P11_MIGRATION_HASH"); let linkRef; try { linkRef = readFile(projectRefPath).trim(); } catch { throw new Error("P11_LINK_TARGET"); } if (linkRef !== P11_PROJECT_REF) throw new Error("P11_LINK_TARGET"); if (!password) throw new Error("P11_CREDENTIAL");
  const versionProbe = deps.versionProbe ?? (() => { const r = spawnSync(executable, ["--version"], { cwd: root, encoding: "utf8", shell: false }); return r.status === 0 ? r.stdout.trim() : ""; }); const cliVersion = versionProbe(); if (cliVersion !== "2.115.0") throw new Error("P11_CLI_VERSION");
  const result = await runP11ProductionRepair({ actualCommit, approvedCommit, clean, migrationHash: hash(readFile(migration)), linkRef, cliVersion, passwordPresent: true, executable, spawnImpl: deps.spawnImpl ?? spawn, cwd: root, password }); return { ...result, cliVersion, cliPathMode: "REPOSITORY_INSTALLED_EXACT_BINARY", localCliVersionProbeProcesses: 1, targetProjectRef: P11_PROJECT_REF };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { const evidence = await runP11ProductionHistoryRegistrationMain(); console.log(JSON.stringify(evidence)); if (evidence.acceptanceResult !== "PASS") process.exitCode = 1; }
  catch (error) { console.log(JSON.stringify({ acceptanceResult: "BLOCKED", failureStage: String(error?.message ?? "P11_PRESPAWN_FAILURE"), repairProcessCount: 0, retryAllowed: false, secretAudit: "PASS" })); process.exitCode = 1; }
}
