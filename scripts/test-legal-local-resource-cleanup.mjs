import assert from "node:assert/strict";
import { cleanupLegalLocalResources } from "./lib/legal-local-resource-cleanup.mjs";

const task = { taskId: "r6-local-predeployment-11111111-2222-4333-8444-555555555555" };
const ready = await cleanupLegalLocalResources({ task, implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2", adapter: { async cleanupTaskResources() { return { remainingContainerCount: 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; } } });
assert.equal(ready.classification, "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY");
await assert.rejects(() => cleanupLegalLocalResources({ task, adapter: { async cleanupTaskResources() { return { remainingContainerCount: 1, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; } } }), (error) => error.code === "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE");
console.log(JSON.stringify({ classification: "R6_LOCAL_RESOURCE_CLEANUP_CONTRACT_TESTS_READY", fixtures: 2, realOperations: 0 }));
