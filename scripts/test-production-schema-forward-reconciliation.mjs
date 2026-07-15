import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const plan = await readFile(path.join(root, "docs", "ops", "legal-consent-production-forward-reconciliation-plan.md"), "utf8");

assert.equal(manifest.format, "openglass-production-schema-forward-reconciliation-v1");
assert.deepEqual(manifest.comparisonCounts, { MATCH: 974, MISSING_IN_PRODUCTION: 134, DIVERGENT_IN_PRODUCTION: 25, EXTRA_IN_PRODUCTION: 10, INSUFFICIENT_EVIDENCE: 0 });
assert.equal(manifest.historicalSecurityFindingCount, 151);
assert.equal(manifest.historicalActionableManifestItemCount, 168);
assert.equal(manifest.historicalUniqueRepairObjectCount, 75);
assert.equal(manifest.securityFindingCount, 131);
assert.equal(manifest.actionableManifestItemCount, 146);
assert.equal(manifest.uniqueRepairObjectCount, 67);
assert.deepEqual(manifest.productionExecutionCounts, {
  productionAppliedManifestItemCount: 22,
  productionAppliedRepairObjectCount: 8,
  pendingManifestItemCount: 146,
  pendingRepairObjectCount: 67,
  pendingSecurityFindingCount: 131,
});
assert.equal(manifest.wave1ExecutionPacket?.status, "PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED");
assert.equal(manifest.wave1ExecutionPacket?.proposalStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
assert.deepEqual(manifest.wave1ExecutionPacket?.exactSignatures, [
  "public.increment_post_view_count(uuid)",
  "public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)",
]);
assert.deepEqual(manifest.wave1ExecutionPacket?.prerequisite, {
  identity: "public.can_access_public_circle(uuid)",
  status: "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED",
  preflightFile: "docs/ops/reconciliation/can-access-public-circle-preflight.sql",
  oneShotPreflightFile: "docs/ops/reconciliation/can-access-public-circle-preflight-one-shot.sql",
  proposalFile: "docs/ops/reconciliation/can-access-public-circle-proposal.sql",
  postflightFile: "docs/ops/reconciliation/can-access-public-circle-postflight.sql",
  executionCommit: "571c852861b34153885cfa4fcdbf3d8f74ba2fb4",
  surroundingDomainDrift: {
    circlesStatusCheck: "SEPARATE_RECONCILIATION_REQUIRED",
    circlesSelectPublic: "SEPARATE_SECURITY_RECONCILIATION_REQUIRED",
    circlesDeleteOwnerOrStaff: "HUMAN_REVIEW_OR_LATER_WAVE",
  },
});
assert.equal(manifest.wave1ExecutionPacket?.realProductionOperations, 2);
assert.equal(manifest.wave1ExecutionPacket?.positivePublicPostSmoke, "DEFERRED_NO_ELIGIBLE_PRODUCTION_CANDIDATE");
const appliedIdentities = new Set(["can_access_public_circle(uuid)", "increment_post_view_count(uuid)", "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)"]);
const appliedItems = manifest.items.filter((item) => appliedIdentities.has(item.identity));
assert.equal(appliedItems.length, 17);
for (const item of appliedItems) {
  assert.equal(item.blockerStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
  assert.equal(item.productionExecutionStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
  assert(item.productionExecutionAudit?.historicalComparisonClassification, `${item.itemId} must retain historical comparison evidence`);
}
assert.equal(manifest.waves.find((wave) => wave.id === "W1_ACL_FUNCTION_HARDENING")?.status, "PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED");
const circlesWave = manifest.waves.find((wave) => wave.id === "W3A_PUBLIC_CIRCLE_BOUNDARY");
assert.equal(circlesWave?.status, "PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED");
assert.equal(circlesWave?.label, "CIRCLES_VISIBILITY_FOUNDATION");
assert.equal(circlesWave?.preflightStatus, "ONE_SHOT_PREFLIGHT_PACKET_READY");
assert.equal(circlesWave?.productionAppliedRepairObjectCount, 4);
assert.equal(circlesWave?.pendingRepairObjectCount, 0);
assert.deepEqual(manifest.circlesVisibilityPreflight, {
  status: "PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED",
  wave: "W3A_PUBLIC_CIRCLE_BOUNDARY",
  label: "CIRCLES_VISIBILITY_FOUNDATION",
  sqlFile: "docs/ops/reconciliation/circles-visibility-production-preflight-one-shot.sql",
  validatorFile: "scripts/validate-circles-visibility-production-preflight.mjs",
  documentationFile: "docs/ops/legal-consent-production-circles-visibility-reconciliation.md",
  repairObjects: ["public.circles.circles_status_check", "public.circles.circles_select_public", "public.circles.circles_delete_owner_or_staff"],
  proposalStatus: "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED",
  hardDeleteProductDecision: "REMOVE_DIRECT_HARD_DELETE_POLICY",
  executionPreflightFile: "docs/ops/reconciliation/circles-visibility-production-execution-preflight.sql",
  proposalFile: "docs/ops/reconciliation/circles-visibility-production-proposal.sql",
  postflightFile: "docs/ops/reconciliation/circles-visibility-production-postflight.sql",
  localValidationStatus: "LOCAL_DOCKER_ONLY_CONVERGED",
  productionExportCommitted: false,
  productionExecutionStatus: "PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED",
  executionAudit: {
    freshExecutionPreflight: "PASS",
    proposalSentOnceUnmodified: true,
    transaction: "COMMITTED",
    postflight: "PASS",
    circleDataMutation: "NONE",
    unrelatedCatalogDrift: "NONE",
    anonymousSmoke: { visible: 7, activeVisible: 7, deletedVisible: 0, inaccessibleActive: 1, writeProbeCreated: false },
  },
});
const circlePreflightItems = manifest.items.filter((item) => manifest.circlesVisibilityPreflight.repairObjects.includes(item.identity));
assert.equal(circlePreflightItems.length, 3);
for (const item of circlePreflightItems) {
  assert.equal(item.preflightStatus, "ONE_SHOT_PREFLIGHT_PACKET_READY");
  assert.equal(item.proposalStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
  assert.match(item.productionExecutionStatus, /^PRODUCTION_(?:APPLIED|REMOVED)_POSTFLIGHT_VERIFIED$/);
  assert(item.productionExecutionAudit?.historicalComparisonClassification, `${item.itemId} must retain historical comparison evidence`);
}
const operationalWave = manifest.waves.find((wave) => wave.id === "W6_OPERATIONAL_GUARDRAILS");
assert.equal(operationalWave?.status, "INDEX_STAGES_APPLIED_POSTFLIGHT_VERIFIED_POLICY_PRIVILEGE_HOLD");
assert.equal(operationalWave?.preflightFile, "docs/ops/reconciliation/operational-guardrails-production-preflight-one-shot.sql");
assert.equal(operationalWave?.validatorFile, "scripts/validate-operational-guardrails-production-preflight.mjs");
assert.equal(operationalWave?.supplementalPreflightFile, "docs/ops/reconciliation/operational-guardrails-production-preflight-supplemental-one-shot.sql");
assert.equal(operationalWave?.policyRemovalStatus, "HELD_PENDING_AUTHENTICATED_SELECT_INSERT_PRIVILEGE_RECONCILIATION");
const operationalItems = manifest.items.filter((item) => item.proposedWave === "W6_OPERATIONAL_GUARDRAILS");
assert.equal(new Set(operationalItems.map((item) => item.repairObjectId)).size, 4);
assert.equal(operationalItems.filter((item) => item.severity === "P0_SECURITY_BROADENING").length, 2);
assert.equal(operationalItems.filter((item) => item.severity === "P1_REQUIRED_SECURITY_OBJECT_MISSING").length, 2);
const stageAItem = operationalItems.find((item) => item.identity === "public.forum_upload_attempts.forum_upload_attempts_purpose_ip_created_idx");
assert.equal(stageAItem?.blockerStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
assert.equal(stageAItem?.productionExecutionStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
assert.deepEqual(stageAItem?.productionExecutionAudit, {
  executionBaselineCommit: "005fd1e9d7bf109181ecd392cfe1840a00cf89c8",
  stage: "W6_INDEX_STAGE_A",
  historicalComparisonClassification: "MISSING_IN_PRODUCTION",
  freshExecutionPreflight: "PASS",
  proposalSentOnceUnmodified: true,
  transaction: "NOT_APPLICABLE_CREATE_INDEX_CONCURRENTLY_OUTSIDE_TRANSACTION",
  postflight: "PASS",
  exactIndexShape: "PASS",
  invalidOrUnfinishedIndexResidue: "NONE",
  stageB: "STILL_MISSING",
  extraPolicies: "UNCHANGED",
  authenticatedPrivilegeHold: "UNCHANGED",
  productionDataMutation: "NONE",
  productionExportCommitted: false,
});
const stageBItem = operationalItems.find((item) => item.identity === "public.forum_upload_attempts.forum_upload_attempts_purpose_user_created_idx");
assert.equal(stageBItem?.blockerStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
assert.equal(stageBItem?.productionExecutionStatus, "PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED");
assert.deepEqual(stageBItem?.productionExecutionAudit, {
  executionBaselineCommit: "715013760c992549412566f7b092acbbe7236961",
  stage: "W6_INDEX_STAGE_B",
  historicalComparisonClassification: "MISSING_IN_PRODUCTION",
  freshExecutionPreflight: "PASS",
  proposalSentOnceUnmodified: true,
  transaction: "NOT_APPLICABLE_CREATE_INDEX_CONCURRENTLY_OUTSIDE_TRANSACTION",
  postflight: "PASS",
  bothIndexShapes: "PASS",
  invalidOrUnfinishedIndexResidue: "NONE",
  extraPolicies: "UNCHANGED",
  authenticatedPrivilegeHold: "UNCHANGED",
  productionDataMutation: "NONE",
  productionExportCommitted: false,
});
assert.equal(new Set(manifest.items.map((item) => item.itemId)).size, manifest.items.length, "every mismatch entry has one stable assignment");
assert.equal(new Set(manifest.items.map((item) => item.comparisonKey)).size, manifest.items.length, "a comparison entry cannot be scheduled twice");
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "MISSING_IN_PRODUCTION").length, 134);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "DIVERGENT_IN_PRODUCTION").length, 25);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "EXTRA_IN_PRODUCTION").length, 9);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "MATCH").length, 0);
assert.equal(manifest.items.filter((item) => item.severity === "P0_SECURITY_BROADENING").length, 31);
assert.equal(manifest.items.filter((item) => item.severity === "P1_REQUIRED_SECURITY_OBJECT_MISSING").length, 120);
const productionComplete = new Set(["PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED", "PRODUCTION_REMOVED_POSTFLIGHT_VERIFIED"]);
const activeItems = manifest.items.filter((item) => !productionComplete.has(item.productionExecutionStatus) && !productionComplete.has(item.blockerStatus));
assert.equal(activeItems.length, manifest.actionableManifestItemCount);
assert.equal(new Set(activeItems.map((item) => item.repairObjectId)).size, manifest.uniqueRepairObjectCount);
assert.equal(activeItems.filter((item) => item.securityClassification !== "POSSIBLE_AVAILABILITY_BREAK").length, manifest.securityFindingCount);
assert.deepEqual(Object.fromEntries(["P0_SECURITY_BROADENING", "P1_REQUIRED_SECURITY_OBJECT_MISSING", "P2_SECURITY_AVAILABILITY_DIVERGENCE", "P3_NON_SECURITY_SCHEMA_DRIFT"].map((severity) => [severity, activeItems.filter((item) => item.severity === severity).length])), {
  P0_SECURITY_BROADENING: 22,
  P1_REQUIRED_SECURITY_OBJECT_MISSING: 109,
  P2_SECURITY_AVAILABILITY_DIVERGENCE: 1,
  P3_NON_SECURITY_SCHEMA_DRIFT: 14,
});
for (const item of manifest.items) {
  assert(item.proposedWave, `${item.itemId} lacks a wave`);
  assert(item.verificationRequirements.length, `${item.itemId} lacks verification`);
  assert(item.rollbackClass, `${item.itemId} lacks rollback/forward-fix classification`);
  assert(item.forwardOnlyRequired, `${item.itemId} must remain forward-only`);
}
const waves = new Map(manifest.waves.map((wave, index) => [wave.id, { ...wave, index }]));
for (const wave of manifest.waves) for (const dependency of wave.dependencies) assert(waves.has(dependency) && waves.get(dependency).index < waves.get(wave.id).index, `${wave.id} has an invalid dependency ${dependency}`);
for (const wave of manifest.waves) {
  const objects = new Set(manifest.items.filter((item) => item.proposedWave === wave.id).map((item) => item.repairObjectId));
  assert(objects.size <= wave.maxObjects, `${wave.id} exceeds its object bound`);
}
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "EXTRA_IN_PRODUCTION" && item.securityClassification === "HARMLESS_EXTRA_OBJECT").length, 0, "only security-relevant extras are planned");
assert(!JSON.stringify(manifest).match(/\b(?:db_push|blind_replay|migration_repair)\b/i), "manifest cannot propose prohibited reconciliation operations");
assert.match(plan, /PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED/);
assert.match(plan, /DEFERRED_NO_ELIGIBLE_PRODUCTION_CANDIDATE/);
assert.match(plan, /67 pending logical repair objects/i);
assert.match(plan, /CIRCLES_VISIBILITY_FOUNDATION/);
assert.match(plan, /W6 operational guardrails[\s\S]*INDEX_STAGES_APPLIED_POSTFLIGHT_VERIFIED_POLICY_PRIVILEGE_HOLD/);
assert.match(plan, /REMOVE_DIRECT_HARD_DELETE_POLICY/);
assert.match(plan, /Track A[\s\S]*Track B/);
console.log(JSON.stringify({ manifestItems: manifest.items.length, uniqueRepairObjects: manifest.uniqueRepairObjectCount, waves: manifest.waves.length, realOperations: 0 }));
