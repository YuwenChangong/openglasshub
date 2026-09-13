import assert from "node:assert/strict";

const MIGRATION_SHA256 = "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215";

const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELEASE_A_AUTHORIZATION_ID = /^release-a-approval-[0-9]{3,}(?![\s\S])/;
const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn|credential|connection[_-]?string|pgpassword|private[_-]?key|access[_-]?key|client[_-]?secret)/i;
const SENSITIVE_VALUE = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:sk|rk|pk|ghp|xox[baprs])[-_][a-z0-9_-]{16,}\b|\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/i;
const CREDENTIAL_HTTP_URL = /\bhttps?:\/\/[^\s\/@]+@/i;

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNoSensitive(value, key = "", seen = new Set()) {
  if (SENSITIVE_KEY.test(key) || (typeof value === "string" && (SENSITIVE_VALUE.test(value) || CREDENTIAL_HTTP_URL.test(value)))) fail("SECRET_OR_DSN_REJECTED");
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail("INVALID_RELEASE_A_GATE_INPUT");
  seen.add(value);
  for (const [childKey, childValue] of Object.entries(value)) assertNoSensitive(childValue, childKey, seen);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isExactMigrationFingerprint(value) {
  return typeof value === "string" && SHA256.test(value) && value.toLowerCase() === MIGRATION_SHA256;
}

function isPriorReleaseAAuthorization(value) {
  return hasExactKeys(value, ["authorizationId", "authorizedAt"])
    && typeof value.authorizationId === "string"
    && RELEASE_A_AUTHORIZATION_ID.test(value.authorizationId)
    && typeof value.authorizedAt === "string"
    && ISO_TIMESTAMP.test(value.authorizedAt)
    && !Number.isNaN(Date.parse(value.authorizedAt));
}

/**
 * Evaluate supplied, local Release A evidence without making any connection or
 * mutation. A true result authorizes only the next human-controlled operation.
 */
export function assertReleaseAProductionGate(input) {
  assertNoSensitive(input);
  if (!hasExactKeys(input, ["localMigrationTests", "candidate", "migrationSha256", "productionSchemaPrecheck", "authorization"])) fail("INVALID_RELEASE_A_GATE_INPUT");

  const missing = [];
  if (!hasExactKeys(input.localMigrationTests, ["status", "migrationSha256"])
    || input.localMigrationTests.status !== "PASS"
    || !isExactMigrationFingerprint(input.localMigrationTests.migrationSha256)) {
    missing.push("LOCAL_MIGRATION_TESTS_REQUIRED");
  }
  if (!hasExactKeys(input.candidate, ["clean"]) || input.candidate.clean !== true) {
    missing.push("CLEAN_CANDIDATE_REQUIRED");
  }
  if (!isExactMigrationFingerprint(input.migrationSha256)) {
    missing.push("MIGRATION_FINGERPRINT_REQUIRED");
  }
  if (!hasExactKeys(input.productionSchemaPrecheck, ["status", "observedMigrationSha256"])
    || input.productionSchemaPrecheck.status !== "PASS"
    || !isExactMigrationFingerprint(input.productionSchemaPrecheck.observedMigrationSha256)) {
    missing.push("EXACT_PRODUCTION_SCHEMA_PRECHECK_REQUIRED");
  }
  if (!isPriorReleaseAAuthorization(input.authorization)) {
    missing.push("RELEASE_A_PRODUCTION_AUTHORIZATION_REQUIRED");
  }
  return Object.freeze({ allowed: missing.length === 0, missing: Object.freeze(missing) });
}

function completeEvidence(overrides = {}) {
  return {
    localMigrationTests: { status: "PASS", migrationSha256: MIGRATION_SHA256 },
    candidate: { clean: true },
    migrationSha256: MIGRATION_SHA256,
    productionSchemaPrecheck: { status: "PASS", observedMigrationSha256: MIGRATION_SHA256 },
    authorization: { authorizationId: "release-a-approval-001", authorizedAt: "2026-09-13T00:00:00.000Z" },
    ...overrides,
  };
}

const absentEvidenceCases = [
  ["local migration tests", { localMigrationTests: null }, "LOCAL_MIGRATION_TESTS_REQUIRED"],
  ["clean candidate", { candidate: { clean: false } }, "CLEAN_CANDIDATE_REQUIRED"],
  ["migration fingerprint", { migrationSha256: "0".repeat(64) }, "MIGRATION_FINGERPRINT_REQUIRED"],
  ["exact Production schema precheck", { productionSchemaPrecheck: null }, "EXACT_PRODUCTION_SCHEMA_PRECHECK_REQUIRED"],
  ["authorization", { authorization: null }, "RELEASE_A_PRODUCTION_AUTHORIZATION_REQUIRED"],
];

for (const [name, overrides, expectedMissing] of absentEvidenceCases) {
  assert.deepEqual(
    assertReleaseAProductionGate(completeEvidence(overrides)),
    { allowed: false, missing: [expectedMissing] },
    `absent ${name} blocks Release A without reporting any supplied values`,
  );
}

assert.deepEqual(
  assertReleaseAProductionGate(completeEvidence()),
  { allowed: true, missing: [] },
  "complete exact evidence and prior Release A authorization satisfy the offline gate",
);

assert.throws(
  () => assertReleaseAProductionGate(completeEvidence({ authorization: { authorizationId: "release-a-approval-001", authorizedAt: "postgresql://user:password@example.test/db" } })),
  { name: "TypeError", message: "SECRET_OR_DSN_REJECTED" },
  "DSN-shaped values are rejected before gate evaluation",
);
assert.throws(
  () => assertReleaseAProductionGate({ ...completeEvidence(), token: "benign" }),
  { name: "TypeError", message: "SECRET_OR_DSN_REJECTED" },
  "credential-shaped keys are rejected without returning or persisting their values",
);
assert.throws(
  () => assertReleaseAProductionGate({ ...completeEvidence(), extra: "benign" }),
  { name: "TypeError", message: "INVALID_RELEASE_A_GATE_INPUT" },
  "unknown input fields cannot alter authorization behavior",
);

console.log("DEVICE_SCHEMA_V1_RELEASE_A_GATE_OK");
