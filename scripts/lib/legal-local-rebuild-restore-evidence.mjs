import { validateLegalNonproductionTargetBinding, LOCAL_NONPRODUCTION_TARGET_CLASS } from "./legal-nonproduction-target-binding.mjs";

export const LEGAL_LOCAL_REBUILD_RESTORE_SCHEMA = "legal-local-nonproduction-rebuild-restore-evidence-v1";
const HASH = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const requireHash = (value, code) => { if (!HASH.test(String(value ?? ""))) fail(code); return value; };
const requireBoolean = (value, expected, code) => { if (value !== expected) fail(code); return value; };
const utc = (value, code) => { const parsed = Date.parse(String(value ?? "")); if (!Number.isFinite(parsed) || !String(value).endsWith("Z")) fail(code); return parsed; };

export function validateLegalLocalRebuildRestoreEvidence(evidence, { targetBinding, now = Date.now() } = {}) {
  const target = validateLegalNonproductionTargetBinding(targetBinding, { now });
  if (target.providerClass !== LOCAL_NONPRODUCTION_TARGET_CLASS) fail("R6_LOCAL_REBUILD_RESTORE_TARGET_CLASS_INVALID");
  if (!isObject(evidence) || evidence.schemaVersion !== LEGAL_LOCAL_REBUILD_RESTORE_SCHEMA) fail("R6_LOCAL_REBUILD_RESTORE_SCHEMA_INVALID");
  if (evidence.taskId !== targetBinding.taskId) fail("R6_LOCAL_REBUILD_RESTORE_TASK_BINDING_INVALID");
  for (const field of ["targetBindingSha256", "bootstrapFingerprintSha256", "preMigrationFingerprintSha256", "rebuiltFingerprintSha256", "destroyedContainerIdentityHash", "rebuiltContainerIdentityHash"]) requireHash(evidence[field], `R6_LOCAL_REBUILD_RESTORE_HASH_INVALID:${field}`);
  if (evidence.destroyedContainerIdentityHash === evidence.rebuiltContainerIdentityHash) fail("R6_LOCAL_REBUILD_RESTORE_DESTROY_NOT_PROVEN");
  if (evidence.preMigrationFingerprintSha256 !== evidence.rebuiltFingerprintSha256) fail("R6_LOCAL_REBUILD_RESTORE_FINGERPRINT_MISMATCH");
  const bootstrappedAt = utc(evidence.bootstrappedAtUtc, "R6_LOCAL_REBUILD_RESTORE_BOOTSTRAP_TIME_INVALID");
  const destroyedAt = utc(evidence.destroyedAtUtc, "R6_LOCAL_REBUILD_RESTORE_DESTROY_TIME_INVALID");
  const rebuiltAt = utc(evidence.rebuiltAtUtc, "R6_LOCAL_REBUILD_RESTORE_REBUILD_TIME_INVALID");
  if (!(bootstrappedAt < destroyedAt && destroyedAt < rebuiltAt) || rebuiltAt > now) fail("R6_LOCAL_REBUILD_RESTORE_TIMELINE_INVALID");
  requireBoolean(evidence.destroyObserved, true, "R6_LOCAL_REBUILD_RESTORE_DESTROY_NOT_PROVEN");
  requireBoolean(evidence.rebuildObserved, true, "R6_LOCAL_REBUILD_RESTORE_REBUILD_NOT_PROVEN");
  if (!isObject(evidence.restoreSmoke)) fail("R6_LOCAL_REBUILD_RESTORE_SMOKE_INVALID");
  for (const field of ["databaseReachable", "migrationHistoryReadable", "requiredSchemasPresent", "fingerprintRecomputed"]) requireBoolean(evidence.restoreSmoke[field], true, `R6_LOCAL_REBUILD_RESTORE_SMOKE_INVALID:${field}`);
  return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_REBUILD_RESTORE_EVIDENCE_READY", taskId: evidence.taskId });
}
