import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_PATH = "docs/ops/device-schema-v1-release-a-migration-history-forensic.json";
const SHA256 = /^[a-f0-9]{64}$/;
const SECRET_SHAPED = /(?:password|secret|token|service[_-]?role[_-]?key|dsn|credential|connection[_-]?string|pgpassword|postgres(?:ql)?:\/\/|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:sk|rk|ghp|xox[baprs])[-_][a-z0-9_-]{16,}\b)/i;
const EXPECTED_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
const EXPECTED_TARGET_CLASS = "SUPABASE_PRODUCTION_PROJECT_OPENGLASS_HUB";
const EXPECTED_REMOTE_VERSIONS = Object.freeze([
  "20260518",
  "20260703",
  "20260815010632",
  "20260902042807",
  "20260904101403",
]);
const EXPECTED_ALIAS_MAPPINGS = Object.freeze([
  {
    remoteVersion: "20260815010632",
    canonicalLocalPath: "supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql",
    classification: "REMOTE_ALIAS_OF_LOCAL_CANONICAL_MIGRATION",
  },
  {
    remoteVersion: "20260904101403",
    canonicalLocalPath: "supabase/migrations/20260904054013_forward_reconcile_security_privileges.sql",
    classification: "DUPLICATE_PROVIDER_RECORDED_VERSION_OF_EXISTING_CHANGE",
  },
]);
const EXPECTED_ROWS = Object.freeze([
  {
    remoteVersion: "20260518",
    remoteName: "forum_phase1_schema",
    remoteStatementCount: 103,
    remoteNormalizedStatementFingerprint: "45548d88844021288e1e9e51588de03a",
    classification: "SHARED_EXACT_VERSION",
    canonicalLocalPath: "supabase/migrations/20260518_forum_phase1_schema.sql",
    canonicalLocalVersion: "20260518",
  },
  {
    remoteVersion: "20260703",
    remoteName: "moderation_action_notifications",
    remoteStatementCount: 3,
    remoteNormalizedStatementFingerprint: "66c548297ac34d5c72c4ab7eb44e36a4",
    classification: "SHARED_EXACT_VERSION",
    canonicalLocalPath: "supabase/migrations/20260703_moderation_action_notifications.sql",
    canonicalLocalVersion: "20260703",
  },
  {
    remoteVersion: "20260815010632",
    remoteName: "admin_circle_lifecycle_and_safe_purge",
    remoteStatementCount: 1,
    remoteNormalizedStatementFingerprint: "f6be6dfbb2de021fb39c690b6617ca71",
    classification: "REMOTE_ALIAS_OF_LOCAL_CANONICAL_MIGRATION",
    canonicalLocalPath: "supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql",
    canonicalLocalVersion: "20260814",
    equivalenceMethod: "WHITESPACE_NORMALIZED_SQL_MD5_MATCH_AND_PRODUCTION_EFFECTS_PRESENT",
    equivalenceFingerprint: "f6be6dfbb2de021fb39c690b6617ca71",
    evidence: Object.freeze([
      "READ_ONLY_SELECT:supabase_migrations.schema_migrations normalized statement fingerprint",
      "LOCAL_NORMALIZED_SQL_MD5:supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql",
      "READ_ONLY_SCHEMA_EFFECTS:circles status hidden, purge preview RPC, purge RPC, report validator trigger, service_role execute grants present and anon execute grants absent",
    ]),
  },
  {
    remoteVersion: "20260902042807",
    remoteName: "forward_reconcile_devices",
    remoteStatementCount: 23,
    remoteNormalizedStatementFingerprint: "ad5eb23824cecb157be13a98837bf99f",
    classification: "SHARED_EXACT_VERSION",
    canonicalLocalPath: "supabase/migrations/20260902042807_forward_reconcile_devices.sql",
    canonicalLocalVersion: "20260902042807",
  },
  {
    remoteVersion: "20260904101403",
    remoteName: "forward_reconcile_security_privileges",
    remoteStatementCount: 1,
    remoteNormalizedStatementFingerprint: "43904c8771355072c2cac5ad3e5528a1",
    classification: "DUPLICATE_PROVIDER_RECORDED_VERSION_OF_EXISTING_CHANGE",
    canonicalLocalPath: "supabase/migrations/20260904054013_forward_reconcile_security_privileges.sql",
    canonicalLocalVersion: "20260904054013",
    equivalenceMethod: "WHITESPACE_NORMALIZED_SQL_MD5_MATCH_AND_EXISTING_SECURITY_AUDIT_POSTCONDITION_PACKET_202_OF_202",
    equivalenceFingerprint: "43904c8771355072c2cac5ad3e5528a1",
    evidence: Object.freeze([
      "READ_ONLY_SELECT:supabase_migrations.schema_migrations normalized statement fingerprint",
      "LOCAL_NORMALIZED_SQL_MD5:supabase/migrations/20260904054013_forward_reconcile_security_privileges.sql",
      "docs/ops/production-security-privilege-audit-v1.json postconditionCounts.totalTuples=202",
      "scripts/qa/test-production-security-privilege-audit-packet.mjs",
    ]),
  },
]);

function fail(message) {
  throw new Error(message);
}

function assertNoSecretShapedValues(value, path = "$") {
  if (typeof value === "string") {
    if (SECRET_SHAPED.test(value)) fail(`SECRET_SHAPED_FIELD:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValues(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_SHAPED.test(key)) fail(`SECRET_SHAPED_FIELD:${path}.${key}`);
      assertNoSecretShapedValues(child, `${path}.${key}`);
    }
  }
}

function assertRepositoryRelativePath(path) {
  if (typeof path !== "string" || path.includes("\\") || path.startsWith("/") || /^[a-z]:/i.test(path)) fail("INVALID_CANONICAL_PATH");
  const absolute = resolve(ROOT, path);
  const migrationRoot = resolve(ROOT, "supabase/migrations");
  const relationship = relative(migrationRoot, absolute);
  if (relationship.startsWith("..") || relationship === "" || relationship.split(sep).includes("..")) fail("CANONICAL_PATH_OUTSIDE_MIGRATIONS");
  return absolute;
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function validateExactRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 5) fail("REMOTE_ROW_COUNT_MUST_BE_5");
  const remoteVersions = rows.map((row) => row.remoteVersion);
  if (new Set(remoteVersions).size !== rows.length) fail("REMOTE_VERSIONS_MUST_BE_UNIQUE");
  if (JSON.stringify(remoteVersions) !== JSON.stringify(EXPECTED_REMOTE_VERSIONS)) fail("REMOTE_VERSION_ORDER_OR_VALUE_CHANGED");
  for (const [index, row] of rows.entries()) {
    const expected = EXPECTED_ROWS[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("INVALID_REMOTE_ROW");
    if (typeof row.remoteName !== "string" || row.remoteName.length === 0) fail("REMOTE_NAME_REQUIRED");
    if (!["SHARED_EXACT_VERSION", "REMOTE_ALIAS_OF_LOCAL_CANONICAL_MIGRATION", "DUPLICATE_PROVIDER_RECORDED_VERSION_OF_EXISTING_CHANGE"].includes(row.classification)) fail("INVALID_CLASSIFICATION");
    if (typeof row.canonicalLocalPath !== "string") fail("CANONICAL_PATH_REQUIRED");
    if (typeof row.canonicalLocalVersion !== "string") fail("CANONICAL_VERSION_REQUIRED");
    if (typeof row.canonicalSha256 !== "string" || !SHA256.test(row.canonicalSha256)) fail("CANONICAL_SHA256_REQUIRED");
    if (!row.equivalence || typeof row.equivalence !== "object") fail("EQUIVALENCE_REQUIRED");
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) fail("EVIDENCE_REQUIRED");
    for (const field of ["remoteName", "remoteStatementCount", "remoteNormalizedStatementFingerprint", "classification", "canonicalLocalPath", "canonicalLocalVersion"]) {
      if (row[field] !== expected[field]) fail(`REMOTE_ROW_METADATA_CHANGED:${row.remoteVersion}`);
    }
    if (row.classification === "SHARED_EXACT_VERSION" && row.remoteVersion !== row.canonicalLocalVersion) fail("SHARED_VERSION_MISMATCH");
    if (row.classification !== "SHARED_EXACT_VERSION" && row.remoteVersion === row.canonicalLocalVersion) fail("ALIAS_REQUIRES_DISTINCT_VERSION");
    if (row.classification !== "SHARED_EXACT_VERSION") {
      if (row.equivalence.method !== expected.equivalenceMethod || row.equivalence.fingerprint !== expected.equivalenceFingerprint) fail(`ALIAS_EQUIVALENCE_CHANGED:${row.remoteVersion}`);
      if (JSON.stringify(row.evidence) !== JSON.stringify(expected.evidence)) fail(`ALIAS_EVIDENCE_CHANGED:${row.remoteVersion}`);
    }
  }
}

export async function validateReleaseAHistoryForensicArtifact({ artifactPath = ARTIFACT_PATH } = {}) {
  const absoluteArtifactPath = resolve(ROOT, artifactPath);
  const artifact = JSON.parse(await readFile(absoluteArtifactPath, "utf8"));
  assertNoSecretShapedValues(artifact);
  if (artifact.schemaVersion !== 1) fail("UNSUPPORTED_SCHEMA_VERSION");
  if (artifact.targetClass !== EXPECTED_TARGET_CLASS) fail("TARGET_CLASS_MISMATCH");
  if (artifact.projectRef !== EXPECTED_PROJECT_REF) fail("PROJECT_REF_MISMATCH");
  if (artifact.remoteMigrationCount !== 5) fail("REMOTE_MIGRATION_COUNT_MUST_BE_5");
  validateExactRows(artifact.rows);

  const aliasMappings = artifact.rows
    .filter((row) => row.classification !== "SHARED_EXACT_VERSION")
    .map(({ remoteVersion, canonicalLocalPath, classification }) => ({ remoteVersion, canonicalLocalPath, classification }));
  if (JSON.stringify(aliasMappings) !== JSON.stringify(EXPECTED_ALIAS_MAPPINGS)) fail("ALIAS_MAPPING_CHANGED");

  let canonicalMappingCount = 0;
  for (const row of artifact.rows) {
    const absoluteCanonicalPath = assertRepositoryRelativePath(row.canonicalLocalPath);
    const actualSha256 = await sha256File(absoluteCanonicalPath);
    if (actualSha256 !== row.canonicalSha256) fail(`CANONICAL_SHA256_MISMATCH:${row.remoteVersion}`);
    canonicalMappingCount += 1;
  }

  const remoteAliasCount = artifact.rows.filter((row) => row.classification !== "SHARED_EXACT_VERSION").length;
  const sharedExactVersionCount = artifact.rows.filter((row) => row.classification === "SHARED_EXACT_VERSION").length;
  const unmappedRemoteVersions = artifact.rows.filter((row) => !row.canonicalLocalPath).map((row) => row.remoteVersion);
  const ambiguousRemoteVersions = artifact.rows.filter((row) => row.classification === "INDETERMINATE").map((row) => row.remoteVersion);
  return Object.freeze({
    artifactPath,
    remoteMigrationCount: artifact.remoteMigrationCount,
    remoteRowCount: artifact.rows.length,
    remoteVersionUniqueCount: new Set(artifact.rows.map((row) => row.remoteVersion)).size,
    canonicalMappingCount,
    unmappedRemoteVersions,
    ambiguousRemoteVersions,
    remoteAliasCount,
    sharedExactVersionCount,
    secretLeaks: 0,
    remoteVersions: artifact.rows.map((row) => row.remoteVersion),
    aliasMappings,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(await validateReleaseAHistoryForensicArtifact(), null, 2));
}
