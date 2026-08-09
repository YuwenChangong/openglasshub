import { createHash } from "node:crypto";
import { fail } from "./r6-production-reconciliation-transport-contract.mjs";

// This query derives a stable, non-secret identity from the connected database session.
export const TARGET_PROBE_SQL = "SELECT json_build_object('database', current_database(), 'serverVersionNum', current_setting('server_version_num'), 'sessionUser', session_user)::text;\n";
export const targetProbeSha256 = () => createHash("sha256").update(TARGET_PROBE_SQL).digest("hex");
export const targetIdentityHash = (observed) => createHash("sha256").update(`r6-postgres-target-v1:${String(observed)}`).digest("hex");

export function verifyTargetIdentity({ approvedTargetIdentitySha256, observedProbeOutput }) {
  if (!/^[a-f0-9]{64}$/.test(String(approvedTargetIdentitySha256 ?? "")) || typeof observedProbeOutput !== "string" || observedProbeOutput.length === 0 || observedProbeOutput.length > 2048) fail("R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_INVALID");
  const actualTargetIdentitySha256 = targetIdentityHash(observedProbeOutput);
  if (actualTargetIdentitySha256 !== approvedTargetIdentitySha256) fail("R6_PRODUCTION_RECONCILIATION_TARGET_MISMATCH");
  return Object.freeze({ approvedTargetIdentitySha256, actualTargetIdentitySha256, targetVerified: true });
}
