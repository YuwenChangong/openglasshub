export const LEGAL_LOCAL_SMOKE_CONTRACT_SCHEMA = "legal-local-nonproduction-smoke-contract-v1";
export const LEGAL_LOCAL_SMOKE_CHECKS = Object.freeze([
  "migration-history-consistency", "schema-constraints-indexes-functions-triggers", "acl-grants", "rls-enabled-forced", "anonymous-denial", "authenticated-policy-matrix", "admin-boundary", "service-role-boundary", "consent-create-read-update-revoke", "legal-version-binding", "deletion-workflow", "security-workflow",
]);

export function evaluateLegalLocalSmokeRuntime(runtimeProfile) {
  if (runtimeProfile !== "LOCAL_SUPABASE_STACK") return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_REQUIRES_LOCAL_SUPABASE_RUNTIME", runnable: false });
  return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_SMOKE_CONTRACT_READY", runnable: true, checks: LEGAL_LOCAL_SMOKE_CHECKS });
}
