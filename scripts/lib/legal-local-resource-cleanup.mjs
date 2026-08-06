const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export async function cleanupLegalLocalResources({ adapter, task, implementationCommit = null }) {
  const result = await adapter.cleanupTaskResources(task);
  if (!result || result.remainingContainerCount !== 0 || result.remainingVolumeCount !== 0 || result.remainingNetworkCount !== 0 || result.unrelatedResourcesChanged !== 0) {
    fail("R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE");
  }
  return Object.freeze({ schemaVersion: "legal-local-resource-cleanup-terminal-v1", taskId: task.taskId, implementationCommit, classification: "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY", cleanupAttempts: 1, ...result });
}
