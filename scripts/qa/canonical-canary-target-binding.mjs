import { createHash } from "node:crypto";

export const CANONICAL_CANARY_TARGET_BINDING_VERSION = "qa-canary-target-binding-v1";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value, code) => { if (typeof value !== "string" || !value.trim()) fail(code); return value; };
const hash = (value, code) => { if (!SHA256.test(String(value))) fail(code); return String(value); };
const commit = (value, code) => { if (!COMMIT.test(String(value))) fail(code); return String(value); };
const exactKeys = (value, keys, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(code);
};

export function canonicalTargetBindingPayload({ resolvedAtUtc, canonicalCircleId, canonicalCircleSlug, baseMutationPlanSchema, baseMutationPlanHash, executionCommit, toolingCommit }) {
  if (!ISO.test(String(resolvedAtUtc)) || !Number.isFinite(Date.parse(resolvedAtUtc))) fail("QA_CANARY_TARGET_BINDING_TIMESTAMP_INVALID");
  if (!UUID.test(String(canonicalCircleId))) fail("QA_CANARY_TARGET_BINDING_CIRCLE_ID_INVALID");
  text(canonicalCircleSlug, "QA_CANARY_TARGET_BINDING_CIRCLE_SLUG_INVALID");
  const payload = {
    schemaVersion: CANONICAL_CANARY_TARGET_BINDING_VERSION,
    resolvedAtUtc,
    canonicalCircleId: String(canonicalCircleId).toLowerCase(),
    canonicalCircleSlug,
    targetKind: "circle",
    targetResolutionMethod: "authenticated-read-only-exact-slug",
    targetResolutionReadOnly: true,
    baseMutationPlanSchema: text(baseMutationPlanSchema, "QA_CANARY_TARGET_BINDING_PLAN_INVALID"),
    baseMutationPlanHash: hash(baseMutationPlanHash, "QA_CANARY_TARGET_BINDING_PLAN_INVALID"),
    executionCommit: commit(executionCommit, "QA_CANARY_TARGET_BINDING_COMMIT_INVALID"),
    toolingCommit: commit(toolingCommit, "QA_CANARY_TARGET_BINDING_COMMIT_INVALID"),
    operationMappings: [
      { operationId: "CREATE_POST", targetKind: "circle", canonicalCircleId: String(canonicalCircleId).toLowerCase() },
      { operationId: "CREATE_COMMENT", targetKind: "created-canary-post" },
    ],
  };
  return Object.freeze(payload);
}

export function createCanonicalCanaryTargetBinding(input) {
  const payload = canonicalTargetBindingPayload(input);
  const targetBindingHash = digest(payload);
  const targetBoundExecutionPlanHash = digest({
    baseMutationPlanSchema: payload.baseMutationPlanSchema,
    baseMutationPlanHash: payload.baseMutationPlanHash,
    targetBindingHash,
    canonicalCircleId: payload.canonicalCircleId,
    canonicalCircleSlug: payload.canonicalCircleSlug,
    executionCommit: payload.executionCommit,
    toolingCommit: payload.toolingCommit,
    operationMappings: payload.operationMappings,
  });
  return Object.freeze({ ...payload, targetBindingHash, targetBoundExecutionPlanHash });
}

export function validateCanonicalCanaryTargetBinding(value, expected = {}) {
  const keys = ["schemaVersion", "resolvedAtUtc", "canonicalCircleId", "canonicalCircleSlug", "targetKind", "targetResolutionMethod", "targetResolutionReadOnly", "baseMutationPlanSchema", "baseMutationPlanHash", "executionCommit", "toolingCommit", "operationMappings", "targetBindingHash", "targetBoundExecutionPlanHash"];
  exactKeys(value, keys, "QA_CANARY_TARGET_BINDING_INVALID");
  if (value.schemaVersion !== CANONICAL_CANARY_TARGET_BINDING_VERSION || value.targetKind !== "circle" || value.targetResolutionMethod !== "authenticated-read-only-exact-slug" || value.targetResolutionReadOnly !== true) fail("QA_CANARY_TARGET_BINDING_INVALID");
  const canonical = createCanonicalCanaryTargetBinding(value);
  if (canonical.targetBindingHash !== value.targetBindingHash || canonical.targetBoundExecutionPlanHash !== value.targetBoundExecutionPlanHash) fail("QA_CANARY_TARGET_BINDING_HASH_MISMATCH");
  for (const [key, expectedValue] of Object.entries(expected)) if (expectedValue !== undefined && canonical[key] !== expectedValue) fail("QA_CANARY_TARGET_BINDING_MISMATCH");
  return canonical;
}

export function resolveCanonicalCircleTarget(rows, requestedSlug) {
  const requested = text(requestedSlug, "QA_CANARY_TARGET_REQUESTED_SLUG_INVALID").trim();
  if (!Array.isArray(rows)) fail("QA_CANARY_TARGET_RESOLUTION_INVALID");
  const matches = rows.filter((row) => row && typeof row === "object" && row.slug === requested);
  if (matches.length !== 1) fail(matches.length === 0 ? "QA_CANARY_TARGET_NOT_FOUND" : "QA_CANARY_TARGET_AMBIGUOUS");
  const circle = matches[0];
  if (!UUID.test(String(circle.id))) fail("QA_CANARY_TARGET_CIRCLE_ID_MISSING");
  if (typeof circle.slug !== "string" || !circle.slug.trim()) fail("QA_CANARY_TARGET_CIRCLE_SLUG_MISSING");
  // The production catalog endpoint is itself the eligibility boundary. Fixtures may
  // explicitly model an ineligible row, which is always rejected.
  if (circle.canaryEligible === false) fail("QA_CANARY_TARGET_INELIGIBLE");
  return Object.freeze({ canonicalCircleId: String(circle.id).toLowerCase(), canonicalCircleSlug: circle.slug });
}
