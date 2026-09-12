import assert from "node:assert/strict";

let buildRecoveryPlan;
let fingerprintRecoveryPlan;
try {
  ({ buildRecoveryPlan, fingerprintRecoveryPlan } = await import("./devices/schema-v1/dry-run.mjs"));
} catch (error) {
  const blocker = new Error("DRY_RUN_PLANNER_MISSING: buildRecoveryPlan and fingerprintRecoveryPlan are not implemented");
  blocker.cause = error;
  throw blocker;
}

const model = {
  definitions: [{ key: "display.refresh_rate", valueType: "number" }],
  devices: [
    { slug: "alpha", brand: "Alpha", model: "One", generation: "1" },
    { slug: "beta", brand: "Beta", model: "Two", generation: "2" },
    { slug: "blocked", brand: "Blocked", model: "Three", generation: "3" },
    { slug: "gamma", brand: "Gamma", model: "Four", generation: "4" },
  ],
  specs: [
    { deviceSlug: "alpha", definitionKey: "display.refresh_rate", region: "Global", variant: "", state: "KNOWN", valueNumber: 120 },
    { deviceSlug: "beta", definitionKey: "display.refresh_rate", region: "Global", variant: "", state: "KNOWN", valueNumber: 90 },
  ],
  sources: [{ url: "https://example.test/source", publisher: "Example" }],
  sourceLinks: [{ deviceSlug: "alpha", sourceUrl: "https://example.test/source", isPrimary: false }],
  evidence: [],
  compatibility: [{ deviceSlug: "alpha", full_specs: { display: { refresh_rate: "120" } }, key_specs: [] }],
  blockers: [{ code: "BLOCKED_EVIDENCE_MAP", deviceKey: "Blocked|Three|3", path: "evidence.conflicts", detail: "Needs curation" }],
};

const existing = {
  definitions: [{ key: "display.refresh_rate", valueType: "number" }],
  devices: [
    { slug: "alpha", brand: "Alpha", model: "One", generation: "1" },
    { slug: "beta", brand: "Beta", model: "Two", generation: "2", catalogAuditProvenance: "initial-import" },
    { slug: "retired", brand: "Retired", model: "Legacy", generation: "0", catalogAuditProvenance: "initial-import" },
  ],
  specs: [
    { deviceSlug: "alpha", definitionKey: "display.refresh_rate", region: "Global", variant: "", state: "KNOWN", valueNumber: 120 },
    { deviceSlug: "beta", definitionKey: "display.refresh_rate", region: "Global", variant: "", state: "KNOWN", valueNumber: 60, catalogAuditProvenance: "initial-import" },
  ],
  sources: [{ url: "https://example.test/source", publisher: "Example" }],
  sourceLinks: [{ deviceSlug: "alpha", sourceUrl: "https://example.test/source", isPrimary: false }],
  evidence: [],
  compatibility: [{ deviceSlug: "alpha", full_specs: { display: { refresh_rate: "120" } }, key_specs: [] }],
};

const plan = buildRecoveryPlan({ model, existing });
assert.equal(plan.delete, "NONE", "the dry run has an explicit immutable no-delete operation");
assert.equal(plan.entries.some((entry) => entry.operation === "DELETE"), false, "the dry run never emits a delete entry");
assert.deepEqual(plan.entries.find((entry) => entry.entity === "device" && entry.key === "retired"), {
  entity: "device", key: "retired", operation: "CONFLICT", desired: null, existing: existing.devices[2], blockers: [], reason: "STALE_EXISTING_ROW_NO_DELETE",
}, "an existing-only row is visible as a no-delete stale conflict instead of silently disappearing");

const operationFor = (entity, key) => plan.entries.find((entry) => entry.entity === entity && entry.key === key)?.operation;
assert.equal(operationFor("device", "alpha"), "UNCHANGED", "identical owned records are unchanged");
assert.equal(operationFor("device", "blocked"), "BLOCKED", "a model blocker blocks its matching device plan");
assert.equal(operationFor("device", "gamma"), "INSERT", "a missing unblocked record is an insert");
assert.equal(operationFor("spec", "beta\u0000display.refresh_rate\u0000Global\u0000"), "UPDATE", "initial-import owned drift is planned as an update");
assert.equal(operationFor("definition", "display.refresh_rate"), "UNCHANGED", "matching registry rows are unchanged");
assert.equal(operationFor("source", "https://example.test/source"), "UNCHANGED", "matching source rows are unchanged");
assert.equal(operationFor("sourceLink", "alpha\u0000https://example.test/source"), "UNCHANGED", "matching source links are unchanged");
assert.equal(operationFor("compatibility", "alpha"), "UNCHANGED", "YAML-derived compatibility is included in the pure plan");

const inserts = plan.entries.filter((entry) => entry.operation === "INSERT");
assert.equal(inserts.length, 1, "missing desired records produce exactly one insert");
assert.deepEqual(inserts[0], { entity: "device", key: "gamma", operation: "INSERT", desired: model.devices[3], existing: null, blockers: [] }, "missing records retain their deterministic desired payload");
assert.deepEqual(plan.entries.find((entry) => entry.entity === "device" && entry.key === "blocked"), { entity: "device", key: "blocked", operation: "BLOCKED", desired: model.devices[2], existing: null, blockers: [model.blockers[0]] }, "blocked desired records retain their deterministic blocker context");

const adminDrift = buildRecoveryPlan({
  model,
  existing: { ...existing, specs: [{ ...existing.specs[0], valueNumber: 110, catalogAuditProvenance: "admin-edit" }, existing.specs[1]] },
});
const adminEntry = adminDrift.entries.find((entry) => entry.entity === "spec" && entry.key.startsWith("alpha\u0000"));
assert.equal(adminEntry.operation, "CONFLICT", "admin-owned drift is never overwritten");
assert.equal(adminEntry.reason, "ADMIN_OR_PROVENANCE_DRIFT", "admin drift explains why operator resolution is needed");

const unknownProvenance = buildRecoveryPlan({
  model,
  existing: { ...existing, devices: [{ ...existing.devices[0], model: "Edited" }, existing.devices[1]] },
});
assert.equal(unknownProvenance.entries.find((entry) => entry.entity === "device" && entry.key === "alpha").operation, "CONFLICT", "unprovenanced existing drift is never overwritten");

const fingerprint = fingerprintRecoveryPlan(plan);
assert.match(fingerprint, /^[a-f0-9]{64}$/, "the plan fingerprint is a SHA-256 hex digest");
const reordered = buildRecoveryPlan({
  model: { ...model, devices: [...model.devices].reverse(), specs: [...model.specs].reverse() },
  existing: { ...existing, devices: [...existing.devices].reverse(), specs: [...existing.specs].reverse() },
});
assert.equal(fingerprintRecoveryPlan(reordered), fingerprint, "sorting makes the fingerprint stable regardless of input order");

const unicodePlan = buildRecoveryPlan({
  model: {
    definitions: [{ key: "é" }, { key: "z" }, { key: "Å" }], devices: [], specs: [], sources: [], sourceLinks: [], evidence: [], blockers: [],
  },
  existing: { definitions: [], devices: [], specs: [], sources: [], sourceLinks: [], evidence: [], compatibility: [] },
});
assert.deepEqual(unicodePlan.entries.map((entry) => entry.key), ["z", "Å", "é"], "Unicode plan keys use locale-independent code-point order");
const reorderedUnicodePlan = buildRecoveryPlan({
  model: { definitions: [{ key: "Å" }, { key: "é" }, { key: "z" }], devices: [], specs: [], sources: [], sourceLinks: [], evidence: [], blockers: [] },
  existing: { definitions: [], devices: [], specs: [], sources: [], sourceLinks: [], evidence: [], compatibility: [] },
});
assert.equal(fingerprintRecoveryPlan(reorderedUnicodePlan), fingerprintRecoveryPlan(unicodePlan), "Unicode plan fingerprints are stable regardless of source array order");

console.log(`DEVICE_SCHEMA_V1_DRY_RUN_OK entries=${plan.entries.length} inserts=${plan.entries.filter((entry) => entry.operation === "INSERT").length} updates=${plan.entries.filter((entry) => entry.operation === "UPDATE").length} unchanged=${plan.entries.filter((entry) => entry.operation === "UNCHANGED").length} conflicts=${plan.entries.filter((entry) => entry.operation === "CONFLICT").length} blocked=${plan.entries.filter((entry) => entry.operation === "BLOCKED").length}`);
