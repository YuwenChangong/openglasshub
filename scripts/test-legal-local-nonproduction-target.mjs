import assert from "node:assert/strict";
import { LOCAL_NONPRODUCTION_TARGET_CLASS, REMOTE_NONPRODUCTION_TARGET_CLASS, evaluateLegalNonproductionTargetProvisioning, validateLegalNonproductionTargetBinding } from "./lib/legal-nonproduction-target-binding.mjs";

const NOW = Date.parse("2026-08-06T00:00:00.000Z");
const hash = (character) => character.repeat(64);
const local = () => ({
  schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: LOCAL_NONPRODUCTION_TARGET_CLASS, environmentClassification: LOCAL_NONPRODUCTION_TARGET_CLASS, environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId: "r6-final-contract-11111111-2222-4333-8444-555555555555", targetIdentityHash: hash("a"), hostIdentityHash: hash("b"), databaseIdentityHash: hash("c"), networkIdentityHash: hash("d"), engine: "postgresql", engineVersion: "15.8", createdAt: "2026-08-05T00:00:00.000Z", expiresAt: "2026-08-07T00:00:00.000Z", disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false, productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true }, localAddressClass: "LOOPBACK", containerRuntime: "docker", containerRuntimeVersion: "27.1", containerIdentityHash: hash("e"), containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false,
});
const reject = (mutate, code) => { const binding = local(); mutate(binding); assert.throws(() => validateLegalNonproductionTargetBinding(binding, { now: NOW }), (error) => error.code === code); };

assert.equal(validateLegalNonproductionTargetBinding(local(), { now: NOW }).classification, "R6_LOCAL_ISOLATED_NONPRODUCTION_TARGET_BINDING_READY");
assert.equal(evaluateLegalNonproductionTargetProvisioning(local(), { now: NOW }).classification, "R6_LOCAL_NONPRODUCTION_TARGET_PROVISIONING_READY");
assert.equal(evaluateLegalNonproductionTargetProvisioning(null).classification, "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_REQUIRED");
const remote = { ...local(), providerClass: REMOTE_NONPRODUCTION_TARGET_CLASS, environmentClassification: REMOTE_NONPRODUCTION_TARGET_CLASS, productionIdentityComparison: { ...local().productionIdentityComparison, source: "FORMAL_ARTIFACT" }, localAddressClass: null, containerRuntime: null, containerRuntimeVersion: null, containerIdentityHash: null, remoteIsolationVerified: true };
assert.equal(validateLegalNonproductionTargetBinding(remote, { now: NOW }).classification, "R6_NONPRODUCTION_TARGET_BINDING_READY");
reject((binding) => { binding.environmentClassification = "PRODUCTION"; }, "R6_NONPRODUCTION_TARGET_CLASSIFICATION_INVALID");
reject((binding) => { binding.productionIdentityComparison.hostIdentityDifferent = false; }, "R6_NONPRODUCTION_TARGET_INEQUALITY_INVALID:hostIdentityDifferent");
reject((binding) => { binding.productionCredentialsPresent = true; }, "R6_NONPRODUCTION_TARGET_PRODUCTION_CREDENTIALS_FORBIDDEN");
reject((binding) => { binding.identityEvidenceVariableName = "QA_DATABASE_URL"; binding.containerIdentityHash = null; }, "R6_LOCAL_NONPRODUCTION_TARGET_CONTAINER_HASH_INVALID");
reject((binding) => { binding.containerTaskOwned = false; }, "R6_LOCAL_NONPRODUCTION_TARGET_CONTAINER_OWNERSHIP_INVALID");
reject((binding) => { binding.localAddressClass = "EXTERNAL_HOST"; }, "R6_LOCAL_NONPRODUCTION_TARGET_ADDRESS_INVALID");
reject((binding) => { binding.persistentBusinessData = true; }, "R6_NONPRODUCTION_TARGET_PERSISTENT_DATA_FORBIDDEN");
console.log(JSON.stringify({ classification: "R6_LOCAL_NONPRODUCTION_TARGET_CONTRACT_TESTS_READY", fixtures: 10, realOperations: 0 }));
