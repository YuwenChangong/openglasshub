import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const plan = await readFile(path.join(root, "docs", "ops", "legal-consent-production-forward-reconciliation-plan.md"), "utf8");

assert.equal(manifest.format, "openglass-production-schema-forward-reconciliation-v1");
assert.deepEqual(manifest.comparisonCounts, { MATCH: 974, MISSING_IN_PRODUCTION: 134, DIVERGENT_IN_PRODUCTION: 25, EXTRA_IN_PRODUCTION: 10, INSUFFICIENT_EVIDENCE: 0 });
assert.equal(manifest.securityFindingCount, 151);
assert.equal(manifest.actionableManifestItemCount, 168);
assert.equal(manifest.uniqueRepairObjectCount, 75);
assert.equal(manifest.wave1ExecutionPacket?.status, "EXECUTION_PACKET_READY_PENDING_HUMAN_APPROVAL");
assert.equal(manifest.wave1ExecutionPacket?.proposalStatus, "PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED");
assert.deepEqual(manifest.wave1ExecutionPacket?.exactSignatures, [
  "public.increment_post_view_count(uuid)",
  "public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)",
]);
assert.equal(new Set(manifest.items.map((item) => item.itemId)).size, manifest.items.length, "every mismatch entry has one stable assignment");
assert.equal(new Set(manifest.items.map((item) => item.comparisonKey)).size, manifest.items.length, "a comparison entry cannot be scheduled twice");
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "MISSING_IN_PRODUCTION").length, 134);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "DIVERGENT_IN_PRODUCTION").length, 25);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "EXTRA_IN_PRODUCTION").length, 9);
assert.equal(manifest.items.filter((item) => item.comparisonClassification === "MATCH").length, 0);
assert.equal(manifest.items.filter((item) => item.severity === "P0_SECURITY_BROADENING").length, 31);
assert.equal(manifest.items.filter((item) => item.severity === "P1_REQUIRED_SECURITY_OBJECT_MISSING").length, 120);
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
assert.match(plan, /PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED/);
assert.match(plan, /no production SQL was authored or executed/i);
assert.match(plan, /Track A[\s\S]*Track B/);
console.log(JSON.stringify({ manifestItems: manifest.items.length, uniqueRepairObjects: manifest.uniqueRepairObjectCount, waves: manifest.waves.length, realOperations: 0 }));
