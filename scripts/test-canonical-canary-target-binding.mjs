import assert from "node:assert/strict";
import {
  CANONICAL_CANARY_TARGET_BINDING_VERSION,
  createCanonicalCanaryTargetBinding,
  validateCanonicalCanaryTargetBinding,
} from "./qa/canonical-canary-target-binding.mjs";

const input = () => ({
  resolvedAtUtc: "2099-01-01T00:00:00.000Z",
  canonicalCircleId: "11111111-1111-4111-8111-111111111111",
  canonicalCircleSlug: "synthetic-canonical-circle",
  baseMutationPlanSchema: "qa-minimal-canary-mutation-plan-v1",
  baseMutationPlanHash: "b".repeat(64),
  executionCommit: "a".repeat(40),
  toolingCommit: "a".repeat(40),
});

const valid = () => createCanonicalCanaryTargetBinding(input());
const expectReject = (value, name) => assert.throws(() => validateCanonicalCanaryTargetBinding(value), /^Error: QA_CANARY_TARGET_BINDING_/, name);

const complete = valid();
assert.equal(complete.schemaVersion, CANONICAL_CANARY_TARGET_BINDING_VERSION);
assert.deepEqual(validateCanonicalCanaryTargetBinding(complete), complete);

const missingSchema = { ...valid() };
delete missingSchema.schemaVersion;
expectReject(missingSchema, "missing schema");

const missingCircleId = { ...valid() };
delete missingCircleId.canonicalCircleId;
expectReject(missingCircleId, "missing canonical circle id");

const missingCircleSlug = { ...valid() };
delete missingCircleSlug.canonicalCircleSlug;
expectReject(missingCircleSlug, "missing canonical circle slug");

const reorderedMappings = { ...valid(), operationMappings: [...valid().operationMappings].reverse() };
const reorderedCanonical = validateCanonicalCanaryTargetBinding(reorderedMappings);
assert.equal(reorderedCanonical.targetBindingHash, complete.targetBindingHash);
assert.equal(reorderedCanonical.targetBoundExecutionPlanHash, complete.targetBoundExecutionPlanHash);

const changedMappings = { ...valid(), operationMappings: [{ operationId: "CREATE_POST", targetKind: "circle", canonicalCircleId: "22222222-2222-4222-8222-222222222222" }, valid().operationMappings[1]] };
expectReject(changedMappings, "changed operation mapping");

const tamperedBindingHash = { ...valid(), targetBindingHash: "0".repeat(64) };
expectReject(tamperedBindingHash, "tampered target binding hash");

const tamperedExecutionPlanHash = { ...valid(), targetBoundExecutionPlanHash: "0".repeat(64) };
expectReject(tamperedExecutionPlanHash, "tampered target-bound execution plan hash");

const mismatchedPlan = { ...valid(), baseMutationPlanHash: "c".repeat(64) };
expectReject(mismatchedPlan, "base mutation plan mismatch");

const historicalSchema = { ...valid(), schemaVersion: "qa-canary-target-binding-v0" };
expectReject(historicalSchema, "historical target binding cannot authorize current production");

process.stdout.write("CANONICAL_CANARY_TARGET_BINDING_TEST_OK\n");
