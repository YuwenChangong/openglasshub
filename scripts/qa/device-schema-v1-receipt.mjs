import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTIFACT_PATH = "artifacts/device-schema-v1/local-recovery-receipt.json";
const RECEIPT_VERSION = "openglass-device-schema-v1-recovery-evidence-v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_AUTHORIZATION_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/i;
const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn|credential|connection[_-]?string|pgpassword|private[_-]?key|access[_-]?key|client[_-]?secret)/i;
const SENSITIVE_VALUE = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:sk|rk|pk|ghp|xox[baprs])[-_][a-z0-9_-]{16,}\b|\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/i;
const CREDENTIAL_HTTP_URL = /\bhttps?:\/\/[^\s\/@]+@/i;
const CREDENTIAL_FILESYSTEM_PATH = /(?:[a-z]:[\\/]|\/)(?:[^\\/\r\n]+[\\/])*[^\\/\r\n]*(?:password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn|credential|connection[_-]?string|pgpassword|private[_-]?key|access[_-]?key|client[_-]?secret)[^\\/\r\n]*/i;
const EXACT_COUNTS = Object.freeze({
  definitions: 92,
  devices: 24,
  sources: 39,
  sourceLinks: 46,
  specs: 1488,
  evidence: 15,
  compatibility: 24,
  publishedDevices: 24,
  uniqueSlugs: 24,
  yamlSourceUrls: 36,
  evidenceOnlyUrls: 3,
  trueValueConflicts: 7,
  unresolvedEvidenceMaps: 0,
});
const OPERATION_COUNTS = Object.freeze({ definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });

function fail(message) {
  throw new TypeError(message);
}

function assertNoSensitive(value, key = "") {
  if (SENSITIVE_KEY.test(key) || (typeof value === "string" && (SENSITIVE_VALUE.test(value) || CREDENTIAL_HTTP_URL.test(value) || CREDENTIAL_FILESYSTEM_PATH.test(value)))) fail("SECRET_OR_DSN_REJECTED");
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitive(item);
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) assertNoSensitive(child, childKey);
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`INVALID_RECEIPT: ${name} must be an object`);
}

function assertExactObject(value, expected, name) {
  assertPlainObject(value, name);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) fail(`INVALID_RECEIPT: ${name} keys are invalid`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) fail(`EXACT_COUNT_MISMATCH: ${key}`);
  }
}

function assertExactKeys(value, keys, name) {
  assertPlainObject(value, name);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) fail(`INVALID_RECEIPT: ${name} keys are invalid`);
}

function assertFingerprint(value, name) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`INVALID_RECEIPT: ${name} must be a SHA-256 fingerprint`);
  return value.toLowerCase();
}

function assertTimestamp(value, name) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) fail(`INVALID_RECEIPT: ${name} must be an ISO timestamp`);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

function validateProduction(production) {
  assertPlainObject(production, "production");
  assertExactKeys(production, ["writes", "writeOccurredAt", "authorizationEvidence"], "production");
  if (!Number.isInteger(production.writes) || production.writes < 0) fail("INVALID_RECEIPT: production.writes must be a non-negative integer");
  if (production.writes === 0) {
    if (production.writeOccurredAt !== null || production.authorizationEvidence !== null) fail("INVALID_RECEIPT: zero production writes cannot carry write authorization evidence");
    return { writes: 0, writeOccurredAt: null, authorizationEvidence: null };
  }
  const writeOccurredAt = assertTimestamp(production.writeOccurredAt, "production.writeOccurredAt");
  if (!production.authorizationEvidence) fail("PRODUCTION_WRITE_AUTHORIZATION_REQUIRED");
  assertPlainObject(production.authorizationEvidence, "production.authorizationEvidence");
  const { authorizationId, authorizedAt } = production.authorizationEvidence;
  if (Object.keys(production.authorizationEvidence).length !== 2 || typeof authorizationId !== "string" || !SAFE_AUTHORIZATION_ID.test(authorizationId)) fail("PRODUCTION_WRITE_AUTHORIZATION_REQUIRED");
  const normalizedAuthorizedAt = assertTimestamp(authorizedAt, "production.authorizationEvidence.authorizedAt");
  // Same-instant evidence cannot prove authorization occurred before the write.
  if (Date.parse(normalizedAuthorizedAt) >= Date.parse(writeOccurredAt)) fail("PRODUCTION_WRITE_AUTHORIZATION_REQUIRED");
  return { writes: production.writes, writeOccurredAt, authorizationEvidence: { authorizationId, authorizedAt: normalizedAuthorizedAt } };
}

function validateInput(input) {
  assertPlainObject(input, "input");
  assertNoSensitive(input);
  const allowed = ["migrationFingerprint", "modelFingerprint", "planFingerprint", "localReceipt", "counts", "production"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail("INVALID_RECEIPT: unsupported input field");
  assertExactObject(input.counts, EXACT_COUNTS, "counts");
  const migrationFingerprint = assertFingerprint(input.migrationFingerprint, "migrationFingerprint");
  const modelFingerprint = assertFingerprint(input.modelFingerprint, "modelFingerprint");
  const planFingerprint = assertFingerprint(input.planFingerprint, "planFingerprint");
  assertPlainObject(input.localReceipt, "localReceipt");
  const local = input.localReceipt;
  assertExactKeys(local, ["format", "targetHost", "planFingerprint", "delete", "operations"], "localReceipt");
  if (local.format !== "openglass-device-schema-v1-local-recovery-receipt-v1" || local.targetHost !== "localhost" || local.delete !== "NONE") fail("INVALID_RECEIPT: local receipt is not a local no-delete recovery receipt");
  if (assertFingerprint(local.planFingerprint, "localReceipt.planFingerprint") !== planFingerprint) fail("INVALID_RECEIPT: plan fingerprints differ");
  assertExactObject(local.operations, OPERATION_COUNTS, "localReceipt.operations");
  return { migrationFingerprint, modelFingerprint, planFingerprint, production: validateProduction(input.production) };
}

/** Write a deterministic, value-blind local Schema v1 recovery-evidence receipt. */
export async function writeSchemaV1Receipt(input) {
  const validated = validateInput(input);
  const receipt = canonicalJson({
    schemaVersion: RECEIPT_VERSION,
    artifactPath: ARTIFACT_PATH,
    fingerprints: { migration: validated.migrationFingerprint, model: validated.modelFingerprint, recoveryPlan: validated.planFingerprint },
    counts: EXACT_COUNTS,
    plan: { delete: "NONE", blocked: 0, conflicts: 0, fingerprint: validated.planFingerprint },
    localReceipt: { targetHost: "localhost", operations: OPERATION_COUNTS },
    production: validated.production,
    sideEffects: { productionDbConnections: 0, providerWrites: 0, cloudflareWrites: 0, remoteDbConnections: 0 },
  });
  const text = `${JSON.stringify(receipt)}\n`;
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, text, { encoding: "utf8", mode: 0o600 });
  return Object.freeze({ path: ARTIFACT_PATH, sha256 });
}
