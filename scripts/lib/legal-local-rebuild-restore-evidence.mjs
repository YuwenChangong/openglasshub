import { validateLegalNonproductionTargetBinding, LOCAL_NONPRODUCTION_TARGET_CLASS } from "./legal-nonproduction-target-binding.mjs";

export const LEGAL_LOCAL_REBUILD_RESTORE_SCHEMA = "legal-local-nonproduction-rebuild-restore-evidence-v1";
export const LEGAL_LOCAL_BASELINE_REBUILD_RESTORE_SCHEMA = "legal-local-prelegal-baseline-rebuild-restore-evidence-v2";
const HASH = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const LEGACY_FIELDS = new Set(["schemaVersion", "taskId", "implementationCommit", "targetBindingSha256", "bootstrapFingerprintSha256", "preMigrationFingerprintSha256", "rebuiltFingerprintSha256", "destroyedContainerIdentityHash", "rebuiltContainerIdentityHash", "bootstrappedAtUtc", "destroyedAtUtc", "rebuiltAtUtc", "destroyObserved", "rebuildObserved", "restoreSmoke"]);
const BASELINE_FIELDS = new Set([...LEGACY_FIELDS, "baselineManifestSha256", "baselineInventorySha256", "baselineCheckpointClassification", "rebuiltBaselineCheckpointClassification", "baselineReapplied"]);
const requireHash = (value, code) => { if (!HASH.test(String(value ?? ""))) fail(code); return value; };
const requireBoolean = (value, expected, code) => { if (value !== expected) fail(code); return value; };
const utc = (value, code) => { const parsed = Date.parse(String(value ?? "")); if (!Number.isFinite(parsed) || !String(value).endsWith("Z")) fail(code); return parsed; };

export function validateLegalLocalRebuildRestoreEvidence(evidence, { targetBinding, now = Date.now() } = {}) {
  const target = validateLegalNonproductionTargetBinding(targetBinding, { now });
  if (target.providerClass !== LOCAL_NONPRODUCTION_TARGET_CLASS) fail("R6_LOCAL_REBUILD_RESTORE_TARGET_CLASS_INVALID");
  if (!isObject(evidence) || !new Set([LEGAL_LOCAL_REBUILD_RESTORE_SCHEMA, LEGAL_LOCAL_BASELINE_REBUILD_RESTORE_SCHEMA]).has(evidence.schemaVersion)) fail("R6_LOCAL_REBUILD_RESTORE_SCHEMA_INVALID");
  const baseline = evidence.schemaVersion === LEGAL_LOCAL_BASELINE_REBUILD_RESTORE_SCHEMA;
  if (Object.keys(evidence).some((field) => !(baseline ? BASELINE_FIELDS : LEGACY_FIELDS).has(field))) fail("R6_LOCAL_REBUILD_RESTORE_UNKNOWN_FIELD");
  if (evidence.taskId !== targetBinding.taskId) fail("R6_LOCAL_REBUILD_RESTORE_TASK_BINDING_INVALID");
  if (evidence.implementationCommit !== targetBinding.implementationCommit) fail("R6_LOCAL_REBUILD_RESTORE_COMMIT_BINDING_INVALID");
  for (const field of ["targetBindingSha256", "bootstrapFingerprintSha256", "preMigrationFingerprintSha256", "rebuiltFingerprintSha256", "destroyedContainerIdentityHash", "rebuiltContainerIdentityHash"]) requireHash(evidence[field], `R6_LOCAL_REBUILD_RESTORE_HASH_INVALID:${field}`);
  if (evidence.destroyedContainerIdentityHash === evidence.rebuiltContainerIdentityHash) fail("R6_LOCAL_REBUILD_RESTORE_DESTROY_NOT_PROVEN");
  if (evidence.preMigrationFingerprintSha256 !== evidence.rebuiltFingerprintSha256) fail("R6_LOCAL_REBUILD_RESTORE_FINGERPRINT_MISMATCH");
  const bootstrappedAt = utc(evidence.bootstrappedAtUtc, "R6_LOCAL_REBUILD_RESTORE_BOOTSTRAP_TIME_INVALID");
  const destroyedAt = utc(evidence.destroyedAtUtc, "R6_LOCAL_REBUILD_RESTORE_DESTROY_TIME_INVALID");
  const rebuiltAt = utc(evidence.rebuiltAtUtc, "R6_LOCAL_REBUILD_RESTORE_REBUILD_TIME_INVALID");
  if (!(bootstrappedAt < destroyedAt && destroyedAt < rebuiltAt) || rebuiltAt > now) fail("R6_LOCAL_REBUILD_RESTORE_TIMELINE_INVALID");
  requireBoolean(evidence.destroyObserved, true, "R6_LOCAL_REBUILD_RESTORE_DESTROY_NOT_PROVEN");
  requireBoolean(evidence.rebuildObserved, true, "R6_LOCAL_REBUILD_RESTORE_REBUILD_NOT_PROVEN");
  if (baseline) {
    for (const field of ["baselineManifestSha256", "baselineInventorySha256"]) requireHash(evidence[field], `R6_LOCAL_REBUILD_RESTORE_HASH_INVALID:${field}`);
    requireBoolean(evidence.baselineReapplied, true, "R6_LOCAL_REBUILD_RESTORE_BASELINE_REAPPLY_NOT_PROVEN");
    if (evidence.baselineCheckpointClassification !== "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY" || evidence.rebuiltBaselineCheckpointClassification !== "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY") fail("R6_LOCAL_REBUILD_RESTORE_BASELINE_CHECKPOINT_INVALID");
  }
  if (!isObject(evidence.restoreSmoke)) fail("R6_LOCAL_REBUILD_RESTORE_SMOKE_INVALID");
  for (const field of ["databaseReachable", "migrationHistoryReadable", "requiredSchemasPresent", "fingerprintRecomputed"]) requireBoolean(evidence.restoreSmoke[field], true, `R6_LOCAL_REBUILD_RESTORE_SMOKE_INVALID:${field}`);
  return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_REBUILD_RESTORE_EVIDENCE_READY", taskId: evidence.taskId });
}
