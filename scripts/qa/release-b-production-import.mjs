import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectApprovedRecoveryWrites, operationCountsForWrites, runRecoveryPlanTransaction } from "../devices/schema-v1/recovery-transaction.mjs";
import { buildSchemaV1RecoveryPlan } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";

export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION = "openglass-device-schema-v1-release-b-authorization-v1";
const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";
const APPROVAL_ID = /^release-b-approval-[0-9]+$(?![\s\S])/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_ENTITIES = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"]);
const EXPECTED_OPERATIONS = Object.freeze({ definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRODUCTION_LEDGER_DIRECTORY = path.join(REPOSITORY_ROOT, "artifacts", "device-schema-v1", "release-b-production-ledger");
const execFile = promisify(execFileCallback);

function exactObject(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) ;
  return value;
}

function fail(code) { throw new Error(code); }

function freezePacket(packet) { return Object.freeze({
  sourceCommit: packet.sourceCommit,
  targetProjectRef: packet.projectRef,
  targetClass: "OpenGlass Hub Supabase Production",
  publishedDevices: packet.expectedAfterCounts.publishedDevices,
  normalizedPayloadSha256: packet.fingerprints.normalizedPayload,
  dryRunFingerprint: packet.fingerprints.recoveryPlan,
  identityMapFingerprint: packet.fingerprints.identityMap,
  sourceMetadataFingerprint: packet.fingerprints.sourceMetadata,
  conflictMapFingerprint: packet.fingerprints.conflictMap,
  importerCodeFingerprint: packet.fingerprints.importerCode,
  normalizedYamlFingerprint: packet.fingerprints.normalizedYaml,
  expectedBeforeCounts: Object.freeze({ devices: 0, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 }),
  expectedAfterCounts: Object.freeze({
    devices: packet.expectedAfterCounts.devices,
    deviceSpecDefinitions: packet.expectedAfterCounts.definitions,
    deviceSpecs: packet.expectedAfterCounts.specs,
    deviceSources: packet.expectedAfterCounts.sources,
    deviceSourceLinks: packet.expectedAfterCounts.sourceLinks,
    deviceSpecEvidence: packet.expectedAfterCounts.evidence,
    catalogAuditEvents: packet.expectedAfterCounts.auditEvents,
  }),
}); }

export async function loadTask17FrozenGate() {
  const gatePath = "scripts/qa/device-schema-v1-release-b-gate.mjs";
  const { stdout } = await execFile("git", ["show", `${TASK_17_COMMIT}:${gatePath}`], { cwd: REPOSITORY_ROOT, encoding: "buffer" });
  const gate = await import(`data:text/javascript;base64,${Buffer.from(stdout).toString("base64")}`);
  if (!gate?.RELEASE_B_PACKET) fail("TASK_17_GATE_ARTIFACT_INVALID");
  return freezePacket(gate.RELEASE_B_PACKET);
}

async function assertCommittedInputBytes(frozen) {
  const inputs = [
    ["src/data/devices/openglasshub_device_data_v1.yaml", frozen.normalizedYamlFingerprint],
    ["scripts/devices/schema-v1/source-metadata.json", frozen.sourceMetadataFingerprint],
    ["scripts/devices/schema-v1/conflict-map.json", frozen.conflictMapFingerprint],
    ["scripts/devices/schema-v1/identity-map.json", frozen.identityMapFingerprint],
    ["scripts/devices/import-device-schema-v1.mjs", frozen.importerCodeFingerprint],
  ];
  for (const [relativePath, expected] of inputs) {
    const { stdout } = await execFile("git", ["show", `${TASK_17_COMMIT}:${relativePath}`], { cwd: REPOSITORY_ROOT, encoding: "buffer" });
    const committed = Buffer.from(stdout);
    if (createHash("sha256").update(committed).digest("hex") !== expected || !committed.equals(await readFile(path.join(REPOSITORY_ROOT, relativePath)))) fail("TASK_17_COMMITTED_INPUT_MISMATCH");
  }
}

export function hashAuthorizationReceipt(receipt) {
  return createHash("sha256").update(`${JSON.stringify(canonicalize(receipt))}\n`, "utf8").digest("hex");
}

function assertStrictUtc(value) {
  if (typeof value !== "string" || !UTC_SECONDS.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== `${value.slice(0, -1)}.000Z`) fail("INVALID_RELEASE_B_AUTHORIZED_AT_UTC");
}

function assertAuthorizationReceipt(receipt, sha256, frozen) {
  const expectedKeys = [
    "schemaVersion", "approvalId", "authorizedAtUtc", "targetProjectRef", "targetClass", "task17Commit", "gateSourceCommit",
    "normalizedPayloadSha256", "dryRunFingerprint", "identityMapFingerprint", "sourceMetadataFingerprint", "conflictMapFingerprint", "importerCodeFingerprint",
    "expectedBeforeCounts", "expectedAfterCounts", "authorizedOperation", "maxAttempts", "allowDeletes", "allowSchemaMutation", "allowMigrationHistoryMutation",
    "allowCloudflareWrites", "allowDeployment", "allowPush", "allowMerge", "allowQaProd",
  ];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || Object.keys(receipt).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(receipt, key))) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  if (typeof sha256 !== "string" || !SHA256.test(sha256) || hashAuthorizationReceipt(receipt) !== sha256) fail("AUTHORIZATION_RECEIPT_SHA256_MISMATCH");
  if (receipt.schemaVersion !== AUTHORIZATION_RECEIPT_SCHEMA_VERSION) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  if (typeof receipt.approvalId !== "string" || !APPROVAL_ID.test(receipt.approvalId)) fail("INVALID_RELEASE_B_APPROVAL_ID");
  assertStrictUtc(receipt.authorizedAtUtc);
  if (receipt.targetProjectRef !== frozen.targetProjectRef || receipt.targetClass !== frozen.targetClass) fail("RELEASE_B_TARGET_MISMATCH");
  if (receipt.task17Commit !== TASK_17_COMMIT) fail("TASK_17_COMMIT_MISMATCH");
  if (receipt.gateSourceCommit !== frozen.sourceCommit) fail("RELEASE_B_GATE_SOURCE_COMMIT_MISMATCH");
  for (const [key, expected] of Object.entries({
    normalizedPayloadSha256: frozen.normalizedPayloadSha256, dryRunFingerprint: frozen.dryRunFingerprint,
    identityMapFingerprint: frozen.identityMapFingerprint, sourceMetadataFingerprint: frozen.sourceMetadataFingerprint,
    conflictMapFingerprint: frozen.conflictMapFingerprint, importerCodeFingerprint: frozen.importerCodeFingerprint,
  })) if (receipt[key] !== expected) fail(`RELEASE_B_${key.toUpperCase()}_MISMATCH`);
  if (!exactObject(receipt.expectedBeforeCounts, frozen.expectedBeforeCounts) || !exactObject(receipt.expectedAfterCounts, frozen.expectedAfterCounts)) fail("RELEASE_B_COUNT_BINDING_MISMATCH");
  if (receipt.authorizedOperation !== "RELEASE_B_PRODUCTION_IMPORT" || receipt.maxAttempts !== 1) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  for (const key of ["allowDeletes", "allowSchemaMutation", "allowMigrationHistoryMutation", "allowCloudflareWrites", "allowDeployment", "allowPush", "allowMerge", "allowQaProd"]) if (receipt[key] !== false) fail("RELEASE_B_FORBIDDEN_CAPABILITY");
}

function assertFrozenPlan(plan, frozen) {
  if (!plan || typeof plan !== "object") fail("INVALID_RELEASE_B_PLAN");
  if (plan.delete !== "NONE") fail("RELEASE_B_DELETE_FORBIDDEN");
  if (plan.normalizedPayloadSha256 !== frozen.normalizedPayloadSha256) fail("RELEASE_B_NORMALIZED_PAYLOAD_MISMATCH");
  if (plan.dryRunFingerprint !== frozen.dryRunFingerprint) fail("RELEASE_B_DRY_RUN_FINGERPRINT_MISMATCH");
  if (!Array.isArray(plan.entries)) fail("INVALID_RELEASE_B_PLAN");
  if (plan.entries.some((entry) => entry?.operation === "DELETE" || !ALLOWED_ENTITIES.includes(entry?.entity))) fail("RELEASE_B_WRITE_SCOPE_VIOLATION");
  const writes = collectApprovedRecoveryWrites(plan, { permittedEntities: ALLOWED_ENTITIES });
  if (!exactObject(operationCountsForWrites(writes), EXPECTED_OPERATIONS)) fail("RELEASE_B_OPERATION_COUNTS_MISMATCH");
  return writes;
}

function assertPrecheck(precheck, frozen) {
  if (!precheck || precheck.releaseAHistory !== "PRESENT" || precheck.schemaPostconditions !== "PASS" || precheck.releaseBApplied !== false || !exactObject(precheck.counts, frozen.expectedBeforeCounts)) fail("RELEASE_B_PRODUCTION_PRECONDITION_DRIFT");
}

function assertPostcheck(postcheck, frozen) {
  if (!postcheck || !exactObject(postcheck.counts, frozen.expectedAfterCounts)
    || postcheck.uniqueSlugs !== 24 || postcheck.publishedDevices !== frozen.publishedDevices
    || postcheck.conflictInvariants !== "PASS" || postcheck.rayBanIdentity !== "ray-ban-meta" || postcheck.unexpectedDeletes !== 0) fail("RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED");
}

async function consumeAuthorization({ ledgerDirectory, approvalId, authorizationReceiptSha256 }) {
  if (typeof ledgerDirectory !== "string" || !ledgerDirectory.trim()) fail("RELEASE_B_EXPLICIT_LEDGER_REQUIRED");
  const canonicalRoot = path.resolve(PRODUCTION_LEDGER_DIRECTORY);
  const supplied = path.resolve(ledgerDirectory);
  if (supplied !== canonicalRoot && !supplied.startsWith(`${canonicalRoot}${path.sep}`)) fail("RELEASE_B_LEDGER_IDENTITY_MISMATCH");
  await mkdir(canonicalRoot, { recursive: true });
  // The caller may select a child directory for test isolation, but never the
  // durable ledger identity: every approval is consumed in this single root.
  const entryPath = path.join(canonicalRoot, `${approvalId}.json`);
  let handle;
  try {
    handle = await open(entryPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") fail("RELEASE_B_APPROVAL_ALREADY_CONSUMED");
    throw error;
  }
  await handle.writeFile(`${JSON.stringify(canonicalize({ schemaVersion: "openglass-device-schema-v1-release-b-consumption-v1", approvalId, authorizationReceiptSha256, status: "STARTED" }))}\n`, "utf8");
  await handle.close();
  return entryPath;
}

/**
 * Bounded offline-testable coordinator. It has no provider client, environment target,
 * migration command, DDL path, retry loop, or default ledger location.
 */
export async function executeReleaseBProductionImport({ args, authorizationReceipt, authorizationReceiptSha256, ledgerDirectory, transport, plan }) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  const frozen = await loadTask17FrozenGate();
  assertAuthorizationReceipt(authorizationReceipt, authorizationReceiptSha256, frozen);
  // Rebuild from committed repository inputs at the last safe point before the
  // target check and transaction. It has no provider or write dependency.
  await assertCommittedInputBytes(frozen);
  const rebuiltPlan = await buildSchemaV1RecoveryPlan();
  const immutablePlan = { ...rebuiltPlan, normalizedPayloadSha256: frozen.normalizedPayloadSha256, dryRunFingerprint: fingerprintRecoveryPlan(rebuiltPlan) };
  const writes = assertFrozenPlan(immutablePlan, frozen);
  // A supplied preview is diagnostic-only: it can block on drift but can never
  // select the rows sent to the transaction.
  if (plan !== undefined) assertFrozenPlan(plan, frozen);
  if (!transport || typeof transport.identifyTarget !== "function" || typeof transport.readPrecheck !== "function" || typeof transport.readPostcheck !== "function") fail("RELEASE_B_TRANSPORT_CONTRACT_REQUIRED");
  const target = await transport.identifyTarget();
  if (!target || target.projectRef !== frozen.targetProjectRef || target.targetClass !== frozen.targetClass) fail("RELEASE_B_TARGET_MISMATCH");
  const consumptionPath = await consumeAuthorization({ ledgerDirectory, approvalId: authorizationReceipt.approvalId, authorizationReceiptSha256 });
  try {
    await runRecoveryPlanTransaction({ client: transport, writes, beforeWrites: async (transaction) => {
      if (typeof transaction.readPrecheckForUpdate !== "function") fail("RELEASE_B_TRANSACTION_PRECHECK_LOCK_REQUIRED");
      assertPrecheck(await transaction.readPrecheckForUpdate(), frozen);
    } });
  } catch (error) {
    if (/^(?:TRANSPORT_|NETWORK_|PROVIDER_UNKNOWN|COMMIT_UNKNOWN|TIMEOUT)/.test(String(error?.code ?? "")) || /(?:timeout|transport loss|provider unknown|uncertain commit)/i.test(String(error?.message ?? ""))) error.code = "RELEASE_B_EXECUTION_AMBIGUOUS";
    throw error;
  }
  try { assertPostcheck(await transport.readPostcheck(), frozen); } catch (error) {
    if (/^(?:TRANSPORT_|NETWORK_|PROVIDER_UNKNOWN|COMMIT_UNKNOWN|TIMEOUT)/.test(String(error?.code ?? "")) || /(?:timeout|transport loss|provider unknown|uncertain commit)/i.test(String(error?.message ?? ""))) error.code = "RELEASE_B_EXECUTION_AMBIGUOUS";
    else error.code = "RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED";
    throw error;
  }
  return Object.freeze({ status: "COMMITTED", approvalId: authorizationReceipt.approvalId, authorizationReceiptSha256, consumptionPath, operations: operationCountsForWrites(writes) });
}

async function main() {
  // Deliberately no CLI adapter: a future reviewed transport must be supplied through
  // the programmatic boundary after a separate authorization artifact is reviewed.
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  fail("RELEASE_B_TRANSPORT_INJECTION_REQUIRED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`RELEASE_B_PRODUCTION_IMPORT_BLOCKED ${error.message}`); process.exitCode = 1; });
}
