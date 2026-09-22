import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  assertObject(value.provenance, "PROVENANCE_REQUIRED");
  assertCommit(value.provenance.specCommit, "SPEC_PLAN_PROVENANCE_REQUIRED");
  assertCommit(value.provenance.planCommit, "SPEC_PLAN_PROVENANCE_REQUIRED");
  for (const key of ["migration", "yaml", "source", "conflict", "identity", "model"]) {
    assertSha(value.fingerprints?.[key], "FINGERPRINT_REQUIRED");
  }
  assertObject(value.counts?.pre, "PRE_POST_COUNTS_REQUIRED");
  assertObject(value.counts?.post, "PRE_POST_COUNTS_REQUIRED");
  if (value.counts.pre.devices !== 0 || value.counts.post.devices !== 24 || value.counts.post.publishedDevices !== 24 || value.counts.post.uniqueDeviceSlugs !== 24) fail("PRE_POST_COUNTS_REQUIRED");
  assertObject(value.routeResult, "ROUTE_RESULT_REQUIRED");
  if (value.routeResult.status !== "PASS" || value.routeResult.productsRoute !== "PASS" || value.routeResult.brandCounts !== "PASS" || value.routeResult.deviceRedirects !== "PASS" || value.routeResult.yamlCompatibility !== "PASS" || value.routeResult.unexpected500Classification !== "PASS") fail("ROUTE_RESULT_REQUIRED");
  return true;
}

assert.equal(validateSchemaV1RecoveryProvenance(template), true);

for (const mutation of [
  (copy) => { delete copy.provenance.specCommit; },
  (copy) => { delete copy.fingerprints.yaml; },
  (copy) => { delete copy.authorizationId; },
  (copy) => { copy.transactionCount = 0; },
  (copy) => { copy.transactionCount = 2; },
  (copy) => { copy.note = "postgresql://user:password@example.test/postgres"; },
  (copy) => { copy.note = "Bearer sentinel"; },
  (copy) => { copy.note = "service_role sentinel"; },
  (copy) => { copy.note = "apikey sentinel"; },
  (copy) => { copy.routeResult.status = "FAIL"; },
]) {
  const copy = structuredClone(template);
  mutation(copy);
  assert.throws(() => validateSchemaV1RecoveryProvenance(copy), TypeError);
}

console.log("DEVICE_SCHEMA_V1_PROVENANCE_OK cases=11 transactionCount=1");
