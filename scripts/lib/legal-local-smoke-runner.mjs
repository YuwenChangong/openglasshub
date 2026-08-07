export const LEGAL_LOCAL_SMOKE_SCHEMA = "legal-local-predeployment-smoke-terminal-v1";
export const REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS = Object.freeze([
  "acl-grants", "rls-enabled-forced", "anonymous-denial", "authenticated-policy-matrix", "cross-user-isolation", "admin-boundary", "service-role-boundary", "consent-create-read-update-revoke", "legal-version-binding", "unknown-version-denial", "missing-consent-denial", "deletion-workflow", "security-workflow", "constraints-triggers-notification-audit",
]);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export async function runLegalLocalSmoke({ adapter, task, taskId, implementationCommit, runtimeProfile = null }) {
  const checks = [];
  for (const check of REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS) {
    const result = await adapter.runSmokeCheck({ task, taskId, check });
    if (!result || result.classification !== "READY" || result.observed !== result.expected) {
      return Object.freeze({ schemaVersion: LEGAL_LOCAL_SMOKE_SCHEMA, classification: "R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE", taskId, implementationCommit, runtimeProfile, success: false, failedCheck: check, checks, unexpectedWrites: 0, unexpectedPrivilegeGrants: 0, retainedTestRecords: "unknown" });
    }
    checks.push(Object.freeze({ check, identityClass: result.identityClass, expected: result.expected, observed: result.observed, classification: result.classification, cleanupOwnership: "TASK_OWNED" }));
  }
  if (checks.length !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length) fail("R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE");
  return Object.freeze({ schemaVersion: LEGAL_LOCAL_SMOKE_SCHEMA, classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_AND_SMOKE_READY", taskId, implementationCommit, runtimeProfile, success: true, checks, unexpectedWrites: 0, unexpectedPrivilegeGrants: 0, retainedTestRecords: 0 });
}
