import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RELEASE_B_PACKET } from "./qa/device-schema-v1-release-b-gate.mjs";

const templatePath = "docs/release/device-schema-v1-recovery-receipt-template.json";

let templateText;
try {
  templateText = await readFile(templatePath, "utf8");
} catch (error) {
  const blocker = new Error("DEVICE_SCHEMA_V1_PROVENANCE_TEMPLATE_MISSING");
  blocker.cause = error;
  throw blocker;
}

const template = JSON.parse(templateText);
assert.equal(template.fingerprints.model, RELEASE_B_PACKET.fingerprints.normalizedModel);
const migrationSha256 = createHash("sha256").update(await readFile("supabase/migrations/20260909195640_device_schema_v1_foundation.sql")).digest("hex");

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CREDENTIAL = /postgres(?:ql)?:\/\/|password=|Bearer\s+|service[_-]?role|apikey/i;

function fail(code) {
  throw new TypeError(code);
}

function assertObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
}

function assertSha(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
}

function assertCommit(value, code) {
  if (typeof value !== "string" || !COMMIT.test(value)) fail(code);
}

function assertNoCredentialText(value) {
  if (typeof value === "string") {
    if (CREDENTIAL.test(value)) fail("CREDENTIAL_SHAPED_TEXT_REJECTED");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialText(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) assertNoCredentialText(child);
  }
}

function validateSchemaV1RecoveryProvenance(value) {
  assertObject(value, "INVALID_PROVENANCE_RECEIPT");
  assertNoCredentialText(value);
  if (value.schemaVersion !== "openglass-device-schema-v1-recovery-provenance-v1") fail("INVALID_PROVENANCE_SCHEMA");
  if (value.authorizationId !== "release-b-approval-10") fail("AUTHORIZATION_ID_REQUIRED");
  if (value.transactionCount !== 1) fail("TRANSACTION_COUNT_MUST_EQUAL_ONE");
  if (value.targetProjectRef !== RELEASE_B_PACKET.projectRef) fail("TARGET_PROJECT_MISMATCH");
  assertObject(value.provenance, "PROVENANCE_REQUIRED");
  assertCommit(value.provenance.specCommit, "SPEC_PLAN_PROVENANCE_REQUIRED");
  assertCommit(value.provenance.planCommit, "SPEC_PLAN_PROVENANCE_REQUIRED");
  assertCommit(value.provenance.migrationCommit, "COMMIT_PROVENANCE_REQUIRED");
  assertCommit(value.provenance.task19Commit, "COMMIT_PROVENANCE_REQUIRED");
  assertCommit(value.provenance.releaseBHead, "COMMIT_PROVENANCE_REQUIRED");
  if (value.provenance.task19Commit !== "9f55cbb899ebc9935c3d82a1d4adbc7bd8cf8124") fail("TASK19_COMMIT_PROVENANCE_MISMATCH");
  for (const [key, expected] of Object.entries({
    yaml: RELEASE_B_PACKET.fingerprints.normalizedYaml,
    source: RELEASE_B_PACKET.fingerprints.sourceMetadata,
    conflict: RELEASE_B_PACKET.fingerprints.conflictMap,
    identity: RELEASE_B_PACKET.fingerprints.identityMap,
    model: RELEASE_B_PACKET.fingerprints.normalizedModel,
    normalizedPayload: RELEASE_B_PACKET.fingerprints.normalizedPayload,
    dryRun: RELEASE_B_PACKET.fingerprints.recoveryPlan,
  })) {
    assertSha(value.fingerprints?.[key], "FINGERPRINT_REQUIRED");
    if (value.fingerprints[key] !== expected) fail("FROZEN_FINGERPRINT_MISMATCH");
  }
  assertSha(value.fingerprints?.migration, "FINGERPRINT_REQUIRED");
  if (value.fingerprints.migration !== migrationSha256) fail("MIGRATION_FINGERPRINT_MISMATCH");
  assertObject(value.artifacts, "ARTIFACT_PROVENANCE_REQUIRED");
  if (value.artifacts.authorizationReceiptPath !== `artifacts/device-schema-v1/release-b-authorization-receipts/${value.authorizationId}.json`
    || value.artifacts.ledgerArtifactPath !== `artifacts/device-schema-v1/release-b-production-ledger/${value.authorizationId}.json`
    || value.artifacts.ledgerStatus !== "STARTED") fail("ARTIFACT_PROVENANCE_REQUIRED");
  assertSha(value.artifacts.authorizationReceiptSha256, "ARTIFACT_PROVENANCE_REQUIRED");
  assertSha(value.artifacts.ledgerArtifactSha256, "ARTIFACT_PROVENANCE_REQUIRED");
  assertObject(value.counts?.pre, "PRE_POST_COUNTS_REQUIRED");
  assertObject(value.counts?.post, "PRE_POST_COUNTS_REQUIRED");
  for (const key of ["devices", "deviceSpecDefinitions", "deviceSpecs", "deviceSources", "deviceSourceLinks", "deviceSpecEvidence", "catalogAuditEvents"]) {
    if (value.counts.pre[key] !== 0) fail("PRE_POST_COUNTS_REQUIRED");
  }
  for (const [key, expected] of Object.entries({
    devices: RELEASE_B_PACKET.expectedAfterCounts.devices,
    deviceSpecDefinitions: RELEASE_B_PACKET.expectedAfterCounts.definitions,
    deviceSpecs: RELEASE_B_PACKET.expectedAfterCounts.specs,
    deviceSources: RELEASE_B_PACKET.expectedAfterCounts.sources,
    deviceSourceLinks: RELEASE_B_PACKET.expectedAfterCounts.sourceLinks,
    deviceSpecEvidence: RELEASE_B_PACKET.expectedAfterCounts.evidence,
    catalogAuditEvents: RELEASE_B_PACKET.expectedAfterCounts.auditEvents,
    publishedDevices: RELEASE_B_PACKET.expectedAfterCounts.publishedDevices,
    uniqueDeviceSlugs: RELEASE_B_PACKET.expectedAfterCounts.uniqueSlugs,
  })) {
    if (value.counts.post[key] !== expected) fail("PRE_POST_COUNTS_REQUIRED");
  }
  assertObject(value.routeResult, "ROUTE_RESULT_REQUIRED");
  if (value.routeResult.status !== "PASS" || value.routeResult.productsRoute !== "PASS" || value.routeResult.brandCounts !== "PASS" || value.routeResult.deviceRedirects !== "PASS" || value.routeResult.yamlCompatibility !== "PASS" || value.routeResult.unexpected500Classification !== "PASS") fail("ROUTE_RESULT_REQUIRED");
  return true;
}

assert.equal(validateSchemaV1RecoveryProvenance(template), true);

const mutations = [
  (copy) => { delete copy.provenance.specCommit; },
  (copy) => { copy.provenance.task19Commit = "0".repeat(40); },
  (copy) => { delete copy.fingerprints.yaml; },
  (copy) => { copy.fingerprints.model = "0".repeat(64); },
  (copy) => { copy.targetProjectRef = "another-project"; },
  (copy) => { copy.counts.post.deviceSpecs = 1; },
  (copy) => { delete copy.authorizationId; },
  (copy) => { copy.transactionCount = 0; },
  (copy) => { copy.transactionCount = 2; },
  (copy) => { copy.note = "postgresql://user:password@example.test/postgres"; },
  (copy) => { copy.note = "Bearer sentinel"; },
  (copy) => { copy.note = "service_role sentinel"; },
  (copy) => { copy.note = "apikey sentinel"; },
  (copy) => { copy.routeResult.status = "FAIL"; },
];
for (const mutation of mutations) {
  const copy = structuredClone(template);
  mutation(copy);
  assert.throws(() => validateSchemaV1RecoveryProvenance(copy), TypeError);
}

console.log(`DEVICE_SCHEMA_V1_PROVENANCE_OK cases=${mutations.length + 1} transactionCount=1`);
