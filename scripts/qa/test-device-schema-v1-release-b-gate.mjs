import assert from "node:assert/strict";
import { assertReleaseBProductionGate, RELEASE_B_PACKET } from "./device-schema-v1-release-b-gate.mjs";

function completeEvidence(overrides = {}) {
  return {
    releaseA: { status: "PASS", migrationHistory: 1, schemaPostconditions: "PASS", migrationSha256: "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215" },
    candidate: { sourceCommit: RELEASE_B_PACKET.sourceCommit, clean: true, isolated: true, committedOnly: true },
    fingerprints: { ...RELEASE_B_PACKET.fingerprints },
    identity: {
      yamlDeviceCount: 24, yamlBrandCount: 8, identityMapCount: 24, uniqueTargetSlugs: 24,
      unresolvedIdentities: 0, rayBanIdentityStatus: "OPERATOR_APPROVED_GEN2", rayBanCanonicalSlug: "ray-ban-meta",
    },
    mapping: {
      unmappedSourceUrls: 0, ambiguousSourceUrls: 0, unresolvedEvidenceMaps: 0,
      trueValueConflictCount: 7, trueValueConflictsValid: true,
    },
    payload: {
      normalizedDeviceCount: 24, normalizedSpecCount: 1488, duplicateDeviceIdentities: 0,
      duplicateSpecIdentities: 0, duplicateSourceIdentities: 0, duplicateEvidenceIdentities: 0,
      rebuildSha256: RELEASE_B_PACKET.fingerprints.normalizedPayload,
      independentRebuildSha256: RELEASE_B_PACKET.fingerprints.normalizedPayload,
    },
    dryRun: { blocked: 0, delete: "NONE", conflicts: 0, operations: { definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 } },
    localRehearsal: { status: "PASS", constraints: "PASS", repaired: false, idempotent: true, secondDryRunBlocked: 0, secondDryRunDelete: "NONE", operations: { definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 } },
    localSqlRehearsal: { status: "PASS", target: "LOCAL_DISPOSABLE_SQL", constraints: "PASS", repaired: false, idempotent: true, secondDryRunBlocked: 0, secondDryRunDelete: "NONE", operations: { definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 } },
    compatibility: { status: "PASS", productsRoute: "PASS", brandGrouping: "PASS", rayBanMetaRoute: "PASS", yamlDerivedSpecs: "PASS" },
    releaseQa: { status: "PASS", productionConnections: 0, providerWrites: 0 },
    productionPrecheck: {
      projectRef: "xcbnxzjlsvtgzixurcof", releaseAHistory: 1, targetTableCount: 6, targetEnumCount: 7,
      targetRlsEnabledCount: 6, deviceSchemaV1ColumnCount: 7, targetPolicyCount: 22,
      functions: "PASS", triggers: "PASS", targetRows: { devices: 0, definitions: 0, specs: 0, sources: 0, sourceLinks: 0, evidence: 0, auditEvents: 0 },
    },
    expectedAfterCounts: { ...RELEASE_B_PACKET.expectedAfterCounts },
    execution: { transaction: "ONE", attempts: 1, retry: "FORBIDDEN", failureDisposition: "STOP_UNKNOWN_STATE" },
    authorization: null,
    ...overrides,
  };
}

assert.deepEqual(
  assertReleaseBProductionGate(completeEvidence()),
  { allowed: false, missing: ["RELEASE_B_PRODUCTION_AUTHORIZATION_REQUIRED"] },
  "complete evidence remains fail-closed until a distinct Release B authorization is supplied",
);

const missingCases = [
  ["unknown or nonzero Production device count", { productionPrecheck: { ...completeEvidence().productionPrecheck, targetRows: { ...completeEvidence().productionPrecheck.targetRows, devices: 1 } } }, "EMPTY_PRODUCTION_TARGET_REQUIRED"],
  ["unresolved Ray-Ban", { identity: { ...completeEvidence().identity, rayBanIdentityStatus: "INDETERMINATE" } }, "RAY_BAN_IDENTITY_REQUIRED"],
  ["incomplete source mapping", { mapping: { ...completeEvidence().mapping, unmappedSourceUrls: 1 } }, "COMPLETE_SOURCE_AND_CONFLICT_MAPPING_REQUIRED"],
  ["non-24 YAML", { identity: { ...completeEvidence().identity, yamlDeviceCount: 23 } }, "EXACT_IDENTITY_COUNTS_REQUIRED"],
  ["unlocked normalized payload", { payload: { ...completeEvidence().payload, independentRebuildSha256: "0".repeat(64) } }, "LOCKED_NORMALIZED_PAYLOAD_REQUIRED"],
  ["wrong expected after count", { expectedAfterCounts: { ...RELEASE_B_PACKET.expectedAfterCounts, devices: 23 } }, "EXACT_PRODUCTION_AFTER_COUNTS_REQUIRED"],
  ["missing real local SQL rehearsal", { localSqlRehearsal: { ...completeEvidence().localSqlRehearsal, status: "NOT_RUN" } }, "LOCAL_SQL_TRANSACTIONAL_REHEARSAL_REQUIRED"],
];

for (const [name, overrides, expected] of missingCases) {
  assert.ok(
    assertReleaseBProductionGate(completeEvidence(overrides)).missing.includes(expected),
    `${name} blocks the release without echoing any supplied value`,
  );
}

assert.deepEqual(
  assertReleaseBProductionGate(completeEvidence({ authorization: { authorizationId: "release-b-approval-001", authorizedAt: "2026-09-14T00:00:00.000Z" } })),
  { allowed: true, missing: [] },
  "all exact offline evidence plus separate Release B authorization authorizes only the future human-controlled operation",
);

assert.throws(
  () => assertReleaseBProductionGate({ ...completeEvidence(), token: "benign" }),
  { name: "TypeError", message: "SECRET_OR_DSN_REJECTED" },
  "secret-bearing keys fail closed",
);

let getterInvocations = 0;
const executableIdentity = () => {};
Object.defineProperty(executableIdentity, "rayBanIdentityStatus", {
  enumerable: true,
  get() { getterInvocations += 1; return "OPERATOR_APPROVED_GEN2"; },
});
assert.throws(
  () => assertReleaseBProductionGate(completeEvidence({ identity: executableIdentity })),
  { name: "TypeError", message: "INVALID_RELEASE_B_GATE_INPUT" },
  "executable identity evidence is rejected before identity diagnostics",
);
assert.equal(getterInvocations, 0, "an executable identity getter is never evaluated");

let proxyTrapInvocations = 0;
let callableInvocations = 0;
const callableProxy = new Proxy(() => {}, {
  get() { proxyTrapInvocations += 1; return "OPERATOR_APPROVED_GEN2"; },
  ownKeys() { proxyTrapInvocations += 1; return []; },
  apply() { callableInvocations += 1; return "unexpected callable result"; },
});
assert.throws(
  () => assertReleaseBProductionGate(completeEvidence({ identity: callableProxy })),
  { name: "TypeError", message: "INVALID_RELEASE_B_GATE_INPUT" },
  "callable Proxy identity evidence is rejected before proxy traps",
);
assert.equal(proxyTrapInvocations, 0, "a callable Proxy cannot execute a trap during validation");
assert.equal(callableInvocations, 0, "a callable Proxy identity is never invoked during validation");

assert.throws(
  () => assertReleaseBProductionGate({ ...completeEvidence(), unknown: "benign" }),
  { name: "TypeError", message: "INVALID_RELEASE_B_GATE_INPUT" },
  "unknown fields cannot expand the authorization packet",
);

console.log("DEVICE_SCHEMA_V1_RELEASE_B_GATE_OK");
