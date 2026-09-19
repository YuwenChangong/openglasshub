import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASE_B_PACKET } from "./device-schema-v1-release-b-gate.mjs";
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

export const RELEASE_B_FROZEN = Object.freeze({
  sourceCommit: RELEASE_B_PACKET.sourceCommit,
  targetProjectRef: RELEASE_B_PACKET.projectRef,
  targetClass: "OpenGlass Hub Supabase Production",
  normalizedPayloadSha256: RELEASE_B_PACKET.fingerprints.normalizedPayload,
  dryRunFingerprint: RELEASE_B_PACKET.fingerprints.recoveryPlan,
  identityMapFingerprint: RELEASE_B_PACKET.fingerprints.identityMap,
  sourceMetadataFingerprint: RELEASE_B_PACKET.fingerprints.sourceMetadata,
  conflictMapFingerprint: RELEASE_B_PACKET.fingerprints.conflictMap,
  importerCodeFingerprint: RELEASE_B_PACKET.fingerprints.importerCode,
  expectedBeforeCounts: Object.freeze({ devices: 0, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 }),
  expectedAfterCounts: Object.freeze({
    devices: RELEASE_B_PACKET.expectedAfterCounts.devices,
    deviceSpecDefinitions: RELEASE_B_PACKET.expectedAfterCounts.definitions,
    deviceSpecs: RELEASE_B_PACKET.expectedAfterCounts.specs,
    deviceSources: RELEASE_B_PACKET.expectedAfterCounts.sources,
    deviceSourceLinks: RELEASE_B_PACKET.expectedAfterCounts.sourceLinks,
    deviceSpecEvidence: RELEASE_B_PACKET.expectedAfterCounts.evidence,
    catalogAuditEvents: RELEASE_B_PACKET.expectedAfterCounts.auditEvents,
  }),
});

export function hashAuthorizationReceipt(receipt) {
  return createHash("sha256").update(`${JSON.stringify(canonicalize(receipt))}\n`, "utf8").digest("hex");
}

function assertStrictUtc(value) {
  if (typeof value !== "string" || !UTC_SECONDS.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== `${value.slice(0, -1)}.000Z`) fail("INVALID_RELEASE_B_AUTHORIZED_AT_UTC");
}

function assertAuthorizationReceipt(receipt, sha256) {
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
  if (receipt.targetProjectRef !== RELEASE_B_FROZEN.targetProjectRef || receipt.targetClass !== RELEASE_B_FROZEN.targetClass) fail("RELEASE_B_TARGET_MISMATCH");
  if (receipt.task17Commit !== TASK_17_COMMIT) fail("TASK_17_COMMIT_MISMATCH");
  if (receipt.gateSourceCommit !== RELEASE_B_FROZEN.sourceCommit) fail("RELEASE_B_GATE_SOURCE_COMMIT_MISMATCH");
  for (const [key, expected] of Object.entries({
    normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256, dryRunFingerprint: RELEASE_B_FROZEN.dryRunFingerprint,
    identityMapFingerprint: RELEASE_B_FROZEN.identityMapFingerprint, sourceMetadataFingerprint: RELEASE_B_FROZEN.sourceMetadataFingerprint,
    conflictMapFingerprint: RELEASE_B_FROZEN.conflictMapFingerprint, importerCodeFingerprint: RELEASE_B_FROZEN.importerCodeFingerprint,
  })) if (receipt[key] !== expected) fail(`RELEASE_B_${key.toUpperCase()}_MISMATCH`);
  if (!exactObject(receipt.expectedBeforeCounts, RELEASE_B_FROZEN.expectedBeforeCounts) || !exactObject(receipt.expectedAfterCounts, RELEASE_B_FROZEN.expectedAfterCounts)) fail("RELEASE_B_COUNT_BINDING_MISMATCH");
  if (receipt.authorizedOperation !== "RELEASE_B_PRODUCTION_IMPORT" || receipt.maxAttempts !== 1) fail("INVALID_RELEASE_B_AUTHORIZATION_RECEIPT");
  for (const key of ["allowDeletes", "allowSchemaMutation", "allowMigrationHistoryMutation", "allowCloudflareWrites", "allowDeployment", "allowPush", "allowMerge", "allowQaProd"]) if (receipt[key] !== false) fail("RELEASE_B_FORBIDDEN_CAPABILITY");
}

function assertFrozenPlan(plan) {
  if (!plan || typeof plan !== "object") fail("INVALID_RELEASE_B_PLAN");
  if (plan.delete !== "NONE") fail("RELEASE_B_DELETE_FORBIDDEN");
  if (plan.normalizedPayloadSha256 !== RELEASE_B_FROZEN.normalizedPayloadSha256) fail("RELEASE_B_NORMALIZED_PAYLOAD_MISMATCH");
  if (plan.dryRunFingerprint !== RELEASE_B_FROZEN.dryRunFingerprint) fail("RELEASE_B_DRY_RUN_FINGERPRINT_MISMATCH");
  if (!Array.isArray(plan.entries)) fail("INVALID_RELEASE_B_PLAN");
  if (plan.entries.some((entry) => entry?.operation === "DELETE" || !ALLOWED_ENTITIES.includes(entry?.entity))) fail("RELEASE_B_WRITE_SCOPE_VIOLATION");
  const writes = collectApprovedRecoveryWrites(plan, { permittedEntities: ALLOWED_ENTITIES });
  if (!exactObject(operationCountsForWrites(writes), EXPECTED_OPERATIONS)) fail("RELEASE_B_OPERATION_COUNTS_MISMATCH");
  return writes;
}

function assertPrecheck(precheck) {
  if (!precheck || precheck.releaseAHistory !== "PRESENT" || precheck.schemaPostconditions !== "PASS" || precheck.releaseBApplied !== false || !exactObject(precheck.counts, RELEASE_B_FROZEN.expectedBeforeCounts)) fail("RELEASE_B_PRODUCTION_PRECONDITION_DRIFT");
}

function assertPostcheck(postcheck) {
  if (!postcheck || !exactObject(postcheck.counts, RELEASE_B_FROZEN.expectedAfterCounts)
    || postcheck.uniqueSlugs !== 24 || postcheck.publishedDevices !== RELEASE_B_PACKET.expectedAfterCounts.publishedDevices
    || postcheck.conflictInvariants !== "PASS" || postcheck.rayBanIdentity !== "ray-ban-meta" || postcheck.unexpectedDeletes !== 0) fail("RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED");
}

async function consumeAuthorization({ ledgerDirectory, approvalId, authorizationReceiptSha256 }) {
  if (typeof ledgerDirectory !== "string" || !ledgerDirectory.trim()) fail("RELEASE_B_EXPLICIT_LEDGER_REQUIRED");
  await mkdir(ledgerDirectory, { recursive: true });
  const entryPath = path.join(ledgerDirectory, `${approvalId}.json`);
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
  assertAuthorizationReceipt(authorizationReceipt, authorizationReceiptSha256);
  // Rebuild from committed repository inputs at the last safe point before the
  // target check and transaction. It has no provider or write dependency.
  const rebuiltPlan = await buildSchemaV1RecoveryPlan();
  assertFrozenPlan({ ...rebuiltPlan, normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256, dryRunFingerprint: fingerprintRecoveryPlan(rebuiltPlan) });
  const writes = assertFrozenPlan(plan);
  if (!transport || typeof transport.identifyTarget !== "function" || typeof transport.readPrecheck !== "function" || typeof transport.readPostcheck !== "function") fail("RELEASE_B_TRANSPORT_CONTRACT_REQUIRED");
  const target = await transport.identifyTarget();
  if (!target || target.projectRef !== RELEASE_B_FROZEN.targetProjectRef || target.targetClass !== RELEASE_B_FROZEN.targetClass) fail("RELEASE_B_TARGET_MISMATCH");
  assertPrecheck(await transport.readPrecheck());
  const consumptionPath = await consumeAuthorization({ ledgerDirectory, approvalId: authorizationReceipt.approvalId, authorizationReceiptSha256 });
  await runRecoveryPlanTransaction({ client: transport, writes });
  assertPostcheck(await transport.readPostcheck());
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
