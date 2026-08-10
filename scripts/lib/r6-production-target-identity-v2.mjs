import { createHash } from "node:crypto";

export const TARGET_IDENTITY_V2_VERSION = "r6-production-target-identity-v2";
export const RUNTIME_ROUTING_IDENTITY_VERSION = "r6-production-runtime-routing-identity-v1";
export const CANONICAL_PRODUCTION_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
export const CANONICAL_TARGET_IDENTITY_V2 = Object.freeze({
  schemaVersion: TARGET_IDENTITY_V2_VERSION,
  provider: "supabase",
  projectRef: CANONICAL_PRODUCTION_PROJECT_REF,
});

const HASH = /^[a-f0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function requiredString(value, field) {
  if (typeof value !== "string") fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  const normalized = value.trim().toLowerCase();
  if (!normalized) fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  if (field === "projectRef" && !PROJECT_REF.test(normalized)) fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  return normalized;
}

export function canonicalTargetIdentityV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== TARGET_IDENTITY_V2_VERSION) fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  const provider = requiredString(value.provider, "provider");
  const projectRef = requiredString(value.projectRef, "projectRef");
  if (provider !== "supabase") fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  return JSON.stringify({ schemaVersion: TARGET_IDENTITY_V2_VERSION, provider, projectRef });
}

export const canonicalTargetIdentityV2Sha256 = value => createHash("sha256").update(canonicalTargetIdentityV2(value), "utf8").digest("hex");

export function parseTargetProbeV2(value) {
  let parsed;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  if (requiredString(parsed.database, "database") !== "postgres") fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID");
  return Object.freeze({ database: "postgres" });
}

export function verifyTargetIdentityV2({ expected, observed }) {
  const expectedCanonical = canonicalTargetIdentityV2(expected);
  const parsedObserved = parseTargetProbeV2(observed);
  let observedIdentity;
  try { observedIdentity = typeof observed === "string" ? JSON.parse(observed) : observed; } catch { fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID"); }
  const observedCanonical = canonicalTargetIdentityV2(observedIdentity);
  const fieldResults = [
    { field: "provider", role: "IDENTITY", expected: JSON.parse(expectedCanonical).provider, observed: JSON.parse(observedCanonical).provider, match: JSON.parse(expectedCanonical).provider === JSON.parse(observedCanonical).provider, blocking: true },
    { field: "projectRef", role: "IDENTITY", expected: JSON.parse(expectedCanonical).projectRef, observed: JSON.parse(observedCanonical).projectRef, match: JSON.parse(expectedCanonical).projectRef === JSON.parse(observedCanonical).projectRef, blocking: true },
    { field: "database", role: "DATABASE_CORROBORATION", expected: "postgres", observed: parsedObserved.database, match: parsedObserved.database === "postgres", blocking: true },
  ];
  const targetMatch = fieldResults.every(result => result.match);
  return Object.freeze({ targetMatch, expectedCanonicalIdentitySha256: canonicalTargetIdentityV2Sha256(expected), observedCanonicalIdentitySha256: canonicalTargetIdentityV2Sha256(observedIdentity), fieldResults });
}

export const TARGET_PROBE_V2_SQL = "SELECT json_build_object('database', current_database(), 'currentUser', current_user, 'sessionUser', session_user, 'serverVersionNum', current_setting('server_version_num'), 'clusterName', current_setting('cluster_name', true), 'inRecovery', pg_is_in_recovery())::text;\n";
export const targetProbeV2Sha256 = () => createHash("sha256").update(TARGET_PROBE_V2_SQL, "utf8").digest("hex");
export function assertTargetIdentityV2Sha256(value) { if (!HASH.test(String(value ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_TARGET_IDENTITY_V2_INVALID"); return value; }

export function parseSupabaseProjectRefAuthority(value) {
  let url;
  try { url = new URL(value); } catch { fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH"); }
  const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (url.protocol !== "https:" || !match || url.pathname !== "/" || url.search || url.hash) fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH");
  return match[1].toLowerCase();
}

export function parseRuntimeRoutingIdentity({ pgUser, pgDatabase, pgHost, pgPort }) {
  const match = /^postgres\.([a-z0-9]{20})$/i.exec(String(pgUser ?? ""));
  if (!match || String(pgDatabase ?? "").trim().toLowerCase() !== "postgres" || !String(pgHost ?? "").trim() || !/^(?:5432|6543)$/.test(String(pgPort ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_IDENTITY_INVALID");
  return Object.freeze({ schemaVersion: RUNTIME_ROUTING_IDENTITY_VERSION, pgUser: String(pgUser).trim().toLowerCase(), parsedProjectRef: match[1].toLowerCase(), pgDatabase: "postgres", pgHost: String(pgHost).trim().toLowerCase(), pgPort: String(pgPort) });
}

export function verifyRuntimeRoutingIdentity({ expectedProjectRef, observed }) {
  const routing = parseRuntimeRoutingIdentity(observed);
  const expected = requiredString(expectedProjectRef, "projectRef");
  return Object.freeze({ targetMatch: routing.parsedProjectRef === expected, expectedProjectRef: expected, observedRoutingIdentity: routing, fieldResults: [{ field: "projectRef", role: "IDENTITY_CRITICAL", expected, observed: routing.parsedProjectRef, match: routing.parsedProjectRef === expected, blocking: true }, { field: "pgDatabase", role: "ROUTING_CONSTRAINT", expected: "postgres", observed: routing.pgDatabase, match: true, blocking: true }] });
}
