import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundExecutionPackage, safeEqual, TRANSPORT_CONTRACT_VERSION, validateAuthorizationV2, validatePsqlCapability, fail } from "../lib/r6-production-reconciliation-transport-contract.mjs";
import { reserveAttempt, transitionReceipt } from "../lib/r6-production-reconciliation-receipt.mjs";
import { verifyTargetIdentity } from "../lib/r6-production-reconciliation-target.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const migrationEnvelope = (bytes) => Buffer.concat([Buffer.from("BEGIN;\n", "utf8"), bytes, Buffer.from("\nCOMMIT;\n", "utf8")]);
const redacted = (value) => String(value ?? "").replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[redacted-connection-uri]").replace(/password\s*=\s*[^\s]+/gi, "password=[redacted]");

function resolvePsqlExecutable() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookup = execFileSync(command, [process.platform === "win32" ? "psql.exe" : "psql"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  if (!lookup || !path.isAbsolute(lookup)) fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE");
  return lookup;
}

export function inspectNativePsqlCapability() {
  try {
    const executablePath = resolvePsqlExecutable();
    const version = execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim();
    const help = execFileSync(executablePath, ["--help"], { encoding: "utf8" });
    const executableSha256 = hash(readFileSync(executablePath));
    return validatePsqlCapability({ executablePath, version, help, executableSha256 });
  } catch (error) { if (error?.code) throw error; fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE"); }
}

function requiredConnectionEnvironment(environment) {
  const names = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  if (names.some((name) => typeof environment[name] !== "string" || environment[name].length === 0)) fail("R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE");
  if (environment.DATABASE_URL || environment.SUPABASE_DB_URL || environment.R6_PRODUCTION_RECONCILIATION_DATABASE_URL) fail("R6_PRODUCTION_RECONCILIATION_CONNECTION_STRING_CHANNEL_FORBIDDEN");
  return Object.freeze(Object.fromEntries(names.map((name) => [name, environment[name]])));
}

function psqlRun({ executablePath, environment, input, tupleOnly = false, outputPath = null }) {
  return new Promise((resolve) => {
    const args = ["-X", "-v", "ON_ERROR_STOP=1", ...(tupleOnly ? ["-qAt"] : ["-q"] ), ...(outputPath ? ["--csv", "-o", outputPath] : [])];
    const child = spawn(executablePath, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...environment, PAGER: "" }, windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ outcome: "TRANSPORT_FAILURE", errorCategory: error.code ?? "PROCESS_START_FAILED" }));
    child.on("close", (code, signal) => finish({ outcome: code === 0 ? "SUCCESS" : "TRANSPORT_FAILURE", code, signal: signal ?? null, stdout, errorCategory: code === 0 ? null : hash(redacted(stderr)) }));
    child.stdin.end(input);
  });
}

export function createNativePsqlClient({ environment = process.env, capability = inspectNativePsqlCapability() } = {}) {
  const connection = requiredConnectionEnvironment(environment);
  return Object.freeze({
    capability,
    async targetProbe(bytes) {
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: bytes, tupleOnly: true });
      if (result.outcome !== "SUCCESS") return { outcome: "TARGET_FAILURE", errorCategory: result.errorCategory };
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      return lines.length === 1 ? { outcome: "TARGET_SUCCESS", observedProbeOutput: lines[0] } : { outcome: "TARGET_FAILURE", errorCategory: "TARGET_PROBE_OUTPUT_INVALID" };
    },
    async submitMigration(bytes) {
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: migrationEnvelope(bytes) });
      return result.outcome === "SUCCESS" ? { outcome: "COMMITTED" } : { outcome: "COMMIT_STATE_UNKNOWN", errorCategory: result.errorCategory };
    },
    async postflight(bytes, { outputPath } = {}) {
      if (!outputPath || !path.isAbsolute(outputPath)) return { outcome: "POSTFLIGHT_FAILURE", errorCategory: "POSTFLIGHT_OUTPUT_PATH_INVALID" };
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: bytes, tupleOnly: false, outputPath });
      return result.outcome === "SUCCESS" ? { outcome: "POSTFLIGHT_SUCCESS", outputPath } : { outcome: "POSTFLIGHT_FAILURE", errorCategory: result.errorCategory };
    },
  });
}

export async function validateOnly({ authorization, packageRoot, confirmationPhrase, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const parsed = validateAuthorizationV2(authorization, { implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  if (!safeEqual(hash(confirmationPhrase), parsed.confirmationSha256)) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_INVALID");
  const pkg = await loadBoundExecutionPackage({ packageRoot, expectedPackageSha256: parsed.packageManifestSha256 });
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_VALIDATE_ONLY_READY", executionAttemptConsumed: false, networkConnections: 0, packageManifestSha256: pkg.manifestSha256, canonicalMigrationSha256: pkg.migration.sha256, postflightSha256: pkg.postflight.sha256 });
}

export async function executeOnce({ authorization, packageRoot, receiptRoot, confirmationPhrase, implementationCommit, launcherSha256, transportSha256, client, sqlClientCapability }) {
  const validation = await validateOnly({ authorization, packageRoot, confirmationPhrase, implementationCommit, launcherSha256, transportSha256, sqlClientCapability: sqlClientCapability ?? client?.capability ?? inspectNativePsqlCapability() });
  const pkg = await loadBoundExecutionPackage({ packageRoot, expectedPackageSha256: authorization.packageManifestSha256 });
  const probe = await client.targetProbe(pkg.targetProbe.bytes);
  if (probe.outcome !== "TARGET_SUCCESS") return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0 });
  try {
    verifyTargetIdentity({ approvedTargetIdentitySha256: authorization.targetIdentitySha256, observedProbeOutput: probe.observedProbeOutput });
  } catch (error) {
    if (error?.code === "R6_PRODUCTION_RECONCILIATION_TARGET_MISMATCH") return Object.freeze({ classification: error.code, executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0 });
    throw error;
  }
  const reservation = await reserveAttempt({ receiptRoot, authorization, packageManifestSha256: pkg.manifestSha256 });
  let receipt = reservation;
  const prepared = await client.prepare?.();
  if (prepared?.outcome === "PRE_SUBMIT_FAILURE") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "FAILED_PRE_SUBMIT", patch: { preSubmitFailure: true } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_PRE_SUBMIT_FAILURE", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "SQL_SUBMITTED", patch: { attemptConsumed: true, sqlSha256: pkg.migration.sha256 } });
  const migration = await client.submitMigration(pkg.migration.bytes);
  if (migration.outcome !== "COMMITTED") {
    const state = migration.outcome === "ROLLED_BACK" ? "FAILED_NOT_COMMITTED" : "COMMIT_STATE_UNKNOWN";
    await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: state, patch: { attemptConsumed: true, terminalFailure: migration.errorCategory ?? migration.outcome } });
    return Object.freeze({ classification: state === "COMMIT_STATE_UNKNOWN" ? "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN" : "R6_PRODUCTION_RECONCILIATION_SQL_ROLLED_BACK", executionAttemptConsumed: true, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: "COMMITTED", patch: { transactionCommitted: true, writesAllowed: false } });
  const postflightOutputPath = path.join(path.dirname(receipt.path), `${authorization.authorizationId}.postflight.csv`);
  const postflight = await client.postflight(pkg.postflight.bytes, { outputPath: postflightOutputPath });
  if (postflight.outcome !== "POSTFLIGHT_SUCCESS") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_FAILED", patch: { postflightCount: 1, postflightFailure: postflight.errorCategory ?? "POSTFLIGHT_FAILURE" } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_FAILED", executionAttemptConsumed: true, productionMutations: "COMMITTED_UNKNOWN_COUNT", postflightCount: 1, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_COMPLETE", patch: { postflightCount: 1, postflightSha256: pkg.postflight.sha256, postflightOutputPath } });
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE", executionAttemptConsumed: true, productionMutations: "COMMITTED", postflightCount: 1, receiptPath: receipt.path, receiptSha256: hash(await readFile(receipt.path)), postflightOutputPath, validateOnly: validation.classification });
}

async function main() {
  const [mode, authorizationPath, packageRoot, receiptRoot] = process.argv.slice(2);
  if (!new Set(["ValidateOnly", "Execute"]).has(mode) || !authorizationPath || !packageRoot || (mode === "Execute" && !receiptRoot)) fail("R6_PRODUCTION_RECONCILIATION_TRANSPORT_INPUT_INVALID");
  const authorization = JSON.parse(await readFile(path.resolve(authorizationPath), "utf8"));
  const implementationCommit = process.env.R6_PRODUCTION_RECONCILIATION_IMPLEMENTATION_COMMIT;
  const launcherSha256 = process.env.R6_PRODUCTION_RECONCILIATION_LAUNCHER_SHA256;
  const transportSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const confirmationPhrase = process.env.R6_PRODUCTION_RECONCILIATION_CONFIRMATION;
  if (typeof confirmationPhrase !== "string") fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_CHANNEL_UNAVAILABLE");
  const result = mode === "ValidateOnly"
    ? await validateOnly({ authorization, packageRoot, confirmationPhrase, implementationCommit, launcherSha256, transportSha256 })
    : await executeOnce({ authorization, packageRoot, receiptRoot, confirmationPhrase, implementationCommit, launcherSha256, transportSha256, client: createNativePsqlClient() });
  process.stdout.write(`${JSON.stringify(result)}${os.EOL}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error?.code ?? error?.message ?? "R6_PRODUCTION_RECONCILIATION_TRANSPORT_FAILED"}${os.EOL}`); process.exitCode = 1; });
