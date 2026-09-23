import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectApprovedRecoveryWrites, operationCountsForWrites, runRecoveryPlanTransaction } from "../devices/schema-v1/recovery-transaction.mjs";
import { buildSchemaV1RecoveryPlan } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";
import { preflightReleaseBProductionTransport } from "./lib/release-b-production-transport.mjs";

export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1 = "openglass-device-schema-v1-release-b-authorization-v1";
export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2 = "openglass-device-schema-v1-release-b-authorization-v2";
export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3 = "openglass-device-schema-v1-release-b-authorization-v3";
export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4 = "openglass-device-schema-v1-release-b-authorization-v4";
export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION = AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4;
export const RELEASE_B_EXECUTOR_SURFACE_VERSION = "release-b-production-transport-v2";
export const RELEASE_B_PRODUCTION_RUNNER_PATH = "scripts/qa/release-b-production-runner.mjs";
export const RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH = "scripts/qa/lib/release-b-production-postgres-adapter.mjs";
const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";
export const TASK_18_TRANSPORT_COMMIT = "fced699e7b5fb1c96832fe52ed9230e281b29e74";
const APPROVAL_ID = /^release-b-approval-[0-9]+$(?![\s\S])/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const ALLOWED_ENTITIES = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"]);
const EXPECTED_OPERATIONS = Object.freeze({ definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRODUCTION_LEDGER_DIRECTORY = path.join(REPOSITORY_ROOT, "artifacts", "device-schema-v1", "release-b-production-ledger");
const execFile = promisify(execFileCallback);
const V1_AUTHORIZATION_KEYS = Object.freeze([
  "schemaVersion", "approvalId", "authorizedAtUtc", "targetProjectRef", "targetClass", "task17Commit", "gateSourceCommit",
  "normalizedPayloadSha256", "dryRunFingerprint", "identityMapFingerprint", "sourceMetadataFingerprint", "conflictMapFingerprint", "importerCodeFingerprint",
  "expectedBeforeCounts", "expectedAfterCounts", "authorizedOperation", "maxAttempts", "allowDeletes", "allowSchemaMutation", "allowMigrationHistoryMutation",
  "allowCloudflareWrites", "allowDeployment", "allowPush", "allowMerge", "allowQaProd",
]);
const V2_AUTHORIZATION_KEYS = Object.freeze([
  ...V1_AUTHORIZATION_KEYS,
  "task18TransportCommit", "task18ExecutorCommit", "productionTransportFingerprint", "productionExecutorFingerprint", "automaticRetry",
]);
const V3_AUTHORIZATION_KEYS = Object.freeze([
  ...V2_AUTHORIZATION_KEYS,
  "runnerPath", "runnerCommit", "productionRunnerFingerprint",
]);
const V4_AUTHORIZATION_KEYS = Object.freeze([
  ...V3_AUTHORIZATION_KEYS,
  "productionPostgresAdapterPath", "productionPostgresAdapterCommit", "productionPostgresAdapterFingerprint",
]);

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

function fail(code) { const error = new Error(code); error.code = code; throw error; }

async function gitShowBytes(commit, relativePath) {
  if (typeof commit !== "string" || !GIT_COMMIT.test(commit)) fail("RELEASE_B_EXECUTION_SURFACE_COMMIT_INVALID");
  const { stdout } = await execFile("git", ["show", `${commit}:${relativePath}`], { cwd: REPOSITORY_ROOT, encoding: "buffer" });
  return Buffer.from(stdout);
}

async function gitHeadCommit() {
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  const commit = stdout.trim();
  if (!GIT_COMMIT.test(commit)) fail("RELEASE_B_EXECUTION_SURFACE_COMMIT_INVALID");
  return commit;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAmbiguous(error) {
  return [error?.code, error?.sqlState].some((code) => /^(?:(?:TRANSPORT_|NETWORK_).+|PROVIDER_UNKNOWN|COMMIT_UNKNOWN|TIMEOUT|ECONNRESET|EPIPE|ETIMEDOUT|57P01)$/.test(String(code ?? "")))
    || /(?:timeout|transport loss|provider unknown|uncertain commit)/i.test(String(error?.message ?? ""));
}

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

export async function computeReleaseBExecutionSurfaceFingerprints({
  task18TransportCommit,
  task18ExecutorCommit,
  runnerCommit,
  adapterCommit,
  transportBytes,
  executorBytes,
  runnerBytes,
  adapterBytes,
} = {}) {
  const executorCommit = task18ExecutorCommit ?? await gitHeadCommit();
  const resolvedTransportCommit = task18TransportCommit ?? executorCommit;
  const resolvedRunnerCommit = runnerCommit ?? executorCommit;
  const resolvedAdapterCommit = adapterCommit ?? executorCommit;
  return Object.freeze({
    task18TransportCommit: resolvedTransportCommit,
    task18ExecutorCommit: executorCommit,
    runnerCommit: resolvedRunnerCommit,
    productionPostgresAdapterCommit: resolvedAdapterCommit,
    productionTransportFingerprint: sha256Bytes(transportBytes ?? await gitShowBytes(resolvedTransportCommit, "scripts/qa/lib/release-b-production-transport.mjs")),
    productionExecutorFingerprint: sha256Bytes(executorBytes ?? await gitShowBytes(executorCommit, "scripts/qa/release-b-production-import.mjs")),
    productionRunnerFingerprint: sha256Bytes(runnerBytes ?? await gitShowBytes(resolvedRunnerCommit, RELEASE_B_PRODUCTION_RUNNER_PATH)),
    productionPostgresAdapterFingerprint: sha256Bytes(adapterBytes ?? await gitShowBytes(resolvedAdapterCommit, RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH)),
  });
}

export function loadReleaseBExecutionSurfaceBinding(options = {}) {
  return computeReleaseBExecutionSurfaceFingerprints(options);
}

function assertStrictUtc(value) {
  if (typeof value !== "string" || !UTC_SECONDS.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== `${value.slice(0, -1)}.000Z`) fail("INVALID_RELEASE_B_AUTHORIZED_AT_UTC");
}

function assertExactReceiptShape(receipt, expectedKeys) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || Object.keys(receipt).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(receipt, key))) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
}

function assertAuthorizationReceiptCore(receipt, sha256, frozen, schemaVersion, expectedKeys) {
  assertExactReceiptShape(receipt, expectedKeys);
  if (typeof sha256 !== "string" || !SHA256.test(sha256) || hashAuthorizationReceipt(receipt) !== sha256) fail("AUTHORIZATION_RECEIPT_SHA256_MISMATCH");
  if (receipt.schemaVersion !== schemaVersion) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
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

export function validateHistoricalReleaseBAuthorizationReceiptV1(receipt, sha256, frozen) {
  assertAuthorizationReceiptCore(receipt, sha256, frozen, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1, V1_AUTHORIZATION_KEYS);
  return Object.freeze({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1, approvalId: receipt.approvalId });
}

export function validateCurrentReleaseBAuthorizationReceiptV2(receipt, sha256, frozen, executionSurface) {
  if (receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1) fail("RELEASE_B_AUTHORIZATION_V2_REQUIRED");
  assertAuthorizationReceiptCore(receipt, sha256, frozen, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2, V2_AUTHORIZATION_KEYS);
  if (!executionSurface || receipt.task18TransportCommit !== executionSurface.task18TransportCommit) fail("RELEASE_B_TASK18_TRANSPORT_COMMIT_MISMATCH");
  if (receipt.task18ExecutorCommit !== executionSurface.task18ExecutorCommit) fail("RELEASE_B_TASK18_EXECUTOR_COMMIT_MISMATCH");
  if (receipt.productionTransportFingerprint !== executionSurface.productionTransportFingerprint) fail("RELEASE_B_PRODUCTION_TRANSPORT_FINGERPRINT_MISMATCH");
  if (receipt.productionExecutorFingerprint !== executionSurface.productionExecutorFingerprint) fail("RELEASE_B_PRODUCTION_EXECUTOR_FINGERPRINT_MISMATCH");
  if (receipt.automaticRetry !== false) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  return Object.freeze({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2, approvalId: receipt.approvalId });
}

export function validateCurrentReleaseBAuthorizationReceiptV3(receipt, sha256, frozen, executionSurface) {
  if (receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1 || receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2) fail("RELEASE_B_AUTHORIZATION_V3_REQUIRED");
  assertAuthorizationReceiptCore(receipt, sha256, frozen, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, V3_AUTHORIZATION_KEYS);
  if (receipt.approvalId === "release-b-approval-1" || receipt.approvalId === "release-b-approval-2") fail("RELEASE_B_HISTORICAL_APPROVAL_NOT_EXECUTABLE");
  if (!executionSurface || receipt.task18TransportCommit !== executionSurface.task18TransportCommit) fail("RELEASE_B_TASK18_TRANSPORT_COMMIT_MISMATCH");
  if (receipt.task18ExecutorCommit !== executionSurface.task18ExecutorCommit) fail("RELEASE_B_TASK18_EXECUTOR_COMMIT_MISMATCH");
  if (receipt.runnerPath !== RELEASE_B_PRODUCTION_RUNNER_PATH) fail("RELEASE_B_PRODUCTION_RUNNER_PATH_MISMATCH");
  if (receipt.runnerCommit !== executionSurface.runnerCommit) fail("RELEASE_B_PRODUCTION_RUNNER_COMMIT_MISMATCH");
  if (receipt.productionTransportFingerprint !== executionSurface.productionTransportFingerprint) fail("RELEASE_B_PRODUCTION_TRANSPORT_FINGERPRINT_MISMATCH");
  if (receipt.productionExecutorFingerprint !== executionSurface.productionExecutorFingerprint) fail("RELEASE_B_PRODUCTION_EXECUTOR_FINGERPRINT_MISMATCH");
  if (receipt.productionRunnerFingerprint !== executionSurface.productionRunnerFingerprint) fail("RELEASE_B_PRODUCTION_RUNNER_FINGERPRINT_MISMATCH");
  if (receipt.automaticRetry !== false) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  return Object.freeze({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, approvalId: receipt.approvalId });
}

export function validateCurrentReleaseBAuthorizationReceiptV4(receipt, sha256, frozen, executionSurface) {
  if (
    receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1
    || receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2
    || receipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3
  ) fail("RELEASE_B_AUTHORIZATION_V4_REQUIRED");
  assertAuthorizationReceiptCore(receipt, sha256, frozen, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4, V4_AUTHORIZATION_KEYS);
  if (receipt.approvalId === "release-b-approval-1" || receipt.approvalId === "release-b-approval-2" || receipt.approvalId === "release-b-approval-3") fail("RELEASE_B_HISTORICAL_APPROVAL_NOT_EXECUTABLE");
  if (!executionSurface || receipt.task18TransportCommit !== executionSurface.task18TransportCommit) fail("RELEASE_B_TASK18_TRANSPORT_COMMIT_MISMATCH");
  if (receipt.task18ExecutorCommit !== executionSurface.task18ExecutorCommit) fail("RELEASE_B_TASK18_EXECUTOR_COMMIT_MISMATCH");
  if (receipt.runnerPath !== RELEASE_B_PRODUCTION_RUNNER_PATH) fail("RELEASE_B_PRODUCTION_RUNNER_PATH_MISMATCH");
  if (receipt.runnerCommit !== executionSurface.runnerCommit) fail("RELEASE_B_PRODUCTION_RUNNER_COMMIT_MISMATCH");
  if (receipt.productionPostgresAdapterPath !== RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH) fail("RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH_MISMATCH");
  if (receipt.productionPostgresAdapterCommit !== executionSurface.productionPostgresAdapterCommit) fail("RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_COMMIT_MISMATCH");
  if (receipt.productionTransportFingerprint !== executionSurface.productionTransportFingerprint) fail("RELEASE_B_PRODUCTION_TRANSPORT_FINGERPRINT_MISMATCH");
  if (receipt.productionExecutorFingerprint !== executionSurface.productionExecutorFingerprint) fail("RELEASE_B_PRODUCTION_EXECUTOR_FINGERPRINT_MISMATCH");
  if (receipt.productionRunnerFingerprint !== executionSurface.productionRunnerFingerprint) fail("RELEASE_B_PRODUCTION_RUNNER_FINGERPRINT_MISMATCH");
  if (receipt.productionPostgresAdapterFingerprint !== executionSurface.productionPostgresAdapterFingerprint) fail("RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_FINGERPRINT_MISMATCH");
  if (receipt.automaticRetry !== false) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  return Object.freeze({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4, approvalId: receipt.approvalId });
}

export function createReleaseBAuthorizationReceiptV2({ approvalId, authorizedAtUtc, frozen, executionSurface }) {
  if (!frozen || !executionSurface) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  return {
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
    approvalId,
    authorizedAtUtc,
    targetProjectRef: frozen.targetProjectRef,
    targetClass: frozen.targetClass,
    task17Commit: TASK_17_COMMIT,
    gateSourceCommit: frozen.sourceCommit,
    normalizedPayloadSha256: frozen.normalizedPayloadSha256,
    dryRunFingerprint: frozen.dryRunFingerprint,
    identityMapFingerprint: frozen.identityMapFingerprint,
    sourceMetadataFingerprint: frozen.sourceMetadataFingerprint,
    conflictMapFingerprint: frozen.conflictMapFingerprint,
    importerCodeFingerprint: frozen.importerCodeFingerprint,
    expectedBeforeCounts: { ...frozen.expectedBeforeCounts },
    expectedAfterCounts: { ...frozen.expectedAfterCounts },
    authorizedOperation: "RELEASE_B_PRODUCTION_IMPORT",
    maxAttempts: 1,
    allowDeletes: false,
    allowSchemaMutation: false,
    allowMigrationHistoryMutation: false,
    allowCloudflareWrites: false,
    allowDeployment: false,
    allowPush: false,
    allowMerge: false,
    allowQaProd: false,
    task18TransportCommit: executionSurface.task18TransportCommit,
    task18ExecutorCommit: executionSurface.task18ExecutorCommit,
    productionTransportFingerprint: executionSurface.productionTransportFingerprint,
    productionExecutorFingerprint: executionSurface.productionExecutorFingerprint,
    automaticRetry: false,
  };
}

export function createReleaseBAuthorizationReceiptV3({ approvalId, authorizedAtUtc, frozen, executionSurface }) {
  const receipt = createReleaseBAuthorizationReceiptV2({ approvalId, authorizedAtUtc, frozen, executionSurface });
  return {
    ...receipt,
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3,
    runnerPath: RELEASE_B_PRODUCTION_RUNNER_PATH,
    runnerCommit: executionSurface.runnerCommit,
    productionRunnerFingerprint: executionSurface.productionRunnerFingerprint,
  };
}

export function createReleaseBAuthorizationReceiptV4({ approvalId, authorizedAtUtc, frozen, executionSurface }) {
  const receipt = createReleaseBAuthorizationReceiptV3({ approvalId, authorizedAtUtc, frozen, executionSurface });
  return {
    ...receipt,
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4,
    productionPostgresAdapterPath: RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH,
    productionPostgresAdapterCommit: executionSurface.productionPostgresAdapterCommit,
    productionPostgresAdapterFingerprint: executionSurface.productionPostgresAdapterFingerprint,
  };
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

export function createReleaseBConsumptionStore(directory) {
  if (typeof directory !== "string" || !directory.trim()) fail("RELEASE_B_EXPLICIT_LEDGER_REQUIRED");
  const root = path.resolve(directory);
  return Object.freeze({ async consume({ approvalId, authorizationReceiptSha256 }) {
    if (!APPROVAL_ID.test(approvalId)) fail("INVALID_RELEASE_B_APPROVAL_ID");
    await mkdir(root, { recursive: true });
    const entryPath = path.join(root, `${approvalId}.json`);
    let handle;
    try {
      handle = await open(entryPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") fail("RELEASE_B_APPROVAL_ALREADY_CONSUMED");
      throw error;
    }
    try {
      await handle.writeFile(`${JSON.stringify(canonicalize({ schemaVersion: "openglass-device-schema-v1-release-b-consumption-v1", approvalId, authorizationReceiptSha256, status: "STARTED" }))}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    return entryPath;
  } });
}

/**
 * Bounded offline-testable coordinator. It has no provider client, environment target,
 * migration command, DDL path, or retry loop.
 */
async function executeReleaseBImport({ args, authorizationReceipt, authorizationReceiptSha256, transport, plan }, consumptionStore) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  if (authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1 || authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2) fail("RELEASE_B_AUTHORIZATION_V3_REQUIRED");
  if (authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3) fail("RELEASE_B_AUTHORIZATION_V4_REQUIRED");
  const frozen = await loadTask17FrozenGate();
  validateCurrentReleaseBAuthorizationReceiptV4(authorizationReceipt, authorizationReceiptSha256, frozen, await computeReleaseBExecutionSurfaceFingerprints());
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
  const consumptionPath = await consumptionStore.consume({ approvalId: authorizationReceipt.approvalId, authorizationReceiptSha256 });
  try {
    await runRecoveryPlanTransaction({ client: transport, writes, beforeWrites: async (transaction) => {
      if (typeof transaction.readPrecheckForUpdate !== "function") fail("RELEASE_B_TRANSACTION_PRECHECK_LOCK_REQUIRED");
      assertPrecheck(await transaction.readPrecheckForUpdate(), frozen);
    } });
  } catch (error) {
    if (isAmbiguous(error)) error.code = "RELEASE_B_EXECUTION_AMBIGUOUS";
    throw error;
  }
  try { assertPostcheck(await transport.readPostcheck(), frozen); } catch (error) {
    if (isAmbiguous(error)) error.code = "RELEASE_B_EXECUTION_AMBIGUOUS";
    else error.code = "RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED";
    throw error;
  }
  return Object.freeze({ status: "COMMITTED", approvalId: authorizationReceipt.approvalId, authorizationReceiptSha256, consumptionPath, operations: operationCountsForWrites(writes) });
}

export function createReleaseBImportExecutor({ consumptionStore }) {
  if (!consumptionStore || typeof consumptionStore.consume !== "function") fail("RELEASE_B_CONSUMPTION_STORE_REQUIRED");
  return (input) => executeReleaseBImport(input, consumptionStore);
}

// The public production entry point always uses the durable canonical store.
// Tests construct a separate executor with an owned temporary consumption store.
export function executeReleaseBProductionImport(input) {
  return executeReleaseBImport(input, createReleaseBConsumptionStore(PRODUCTION_LEDGER_DIRECTORY));
}

/** Offline-only wiring validation. This never opens a session or consumes an approval. */
export function preflightReleaseBProductionImport({ environment = process.env } = {}) {
  const transport = preflightReleaseBProductionTransport({ environment });
  return Object.freeze({ ...transport, executorRequiresExplicitTransportInjection: true, authorizationConsumed: false, productionConnections: 0 });
}

async function main() {
  // Deliberately no CLI adapter: a future reviewed transport must be supplied through
  // the programmatic boundary after a separate authorization artifact is reviewed.
  const args = process.argv.slice(2);
  if (args.length !== 1) fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  if (args[0] === "--preflight-production-transport") {
    console.log(JSON.stringify(preflightReleaseBProductionImport()));
    return;
  }
  if (args[0] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  fail("RELEASE_B_TRANSPORT_INJECTION_REQUIRED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`RELEASE_B_PRODUCTION_IMPORT_BLOCKED ${error.message}`); process.exitCode = 1; });
}
