import assert from "node:assert/strict";
import {
  CANONICAL_TARGET_IDENTITY_V2, canonicalTargetIdentityV2Sha256, parseTargetProbeV2,
  TARGET_IDENTITY_V2_VERSION, verifyTargetIdentityV2,
  parseSupabaseProjectRefAuthority, parseRuntimeRoutingIdentity, verifyRuntimeRoutingIdentity,
  CANONICAL_PRODUCTION_DATABASE_ROUTE_V1, canonicalProductionDatabaseRouteV1Sha256,
  validateProductionDatabaseRouteV1,
} from "./lib/r6-production-target-identity-v2.mjs";

const expected = CANONICAL_TARGET_IDENTITY_V2;
const baseline = canonicalTargetIdentityV2Sha256(expected);
assert.equal(verifyTargetIdentityV2({ expected, observed: { ...expected, database: "postgres", serverVersionNum: "170006", serverAddress: "example" } }).targetMatch, true);
assert.equal(verifyTargetIdentityV2({ expected, observed: JSON.stringify({ database: "postgres", ...expected, serverVersion: "17.5" }) }).targetMatch, true);
assert.equal(canonicalTargetIdentityV2Sha256({ provider: "SUPABASE", projectRef: " XCBNXZJLSVTGZIXURCOF ", schemaVersion: TARGET_IDENTITY_V2_VERSION }), baseline);
assert.equal(verifyTargetIdentityV2({ expected, observed: { ...expected, projectRef: "aaaaaaaaaaaaaaaaaaaa", database: "postgres" } }).targetMatch, false);
for (const value of [{ database: null }, { database: "" }, { database: "not-postgres" }]) assert.throws(() => parseTargetProbeV2(value), /TARGET_IDENTITY_V2_INVALID/);
assert.deepEqual(parseTargetProbeV2({ database: "postgres", sessionUser: "postgres" }), { database: "postgres" });
assert.equal(parseSupabaseProjectRefAuthority("https://xcbnxzjlsvtgzixurcof.supabase.co"), "xcbnxzjlsvtgzixurcof");
assert.equal(verifyRuntimeRoutingIdentity({ expectedProjectRef: "xcbnxzjlsvtgzixurcof", observed: { pgUser: "postgres.xcbnxzjlsvtgzixurcof", pgDatabase: "postgres", pgHost: "pooler.example", pgPort: "5432" } }).targetMatch, true);
assert.equal(verifyRuntimeRoutingIdentity({ expectedProjectRef: "xcbnxzjlsvtgzixurcof", observed: { pgUser: "postgres.aaaaaaaaaaaaaaaaaaaa", pgDatabase: "postgres", pgHost: "pooler.example", pgPort: "5432" } }).targetMatch, false);
for (const pgUser of ["postgres", "postgres.", ".postgres", "postgres..xcbnxzjlsvtgzixurcof", "postgres.other.extra", ""]) assert.throws(() => parseRuntimeRoutingIdentity({ pgUser, pgDatabase: "postgres", pgHost: "pooler.example", pgPort: "5432" }), /RUNTIME_ROUTING_IDENTITY_INVALID/);
assert.equal(validateProductionDatabaseRouteV1(CANONICAL_PRODUCTION_DATABASE_ROUTE_V1).pgHost, "aws-1-ap-northeast-1.pooler.supabase.com");
assert.match(canonicalProductionDatabaseRouteV1Sha256(CANONICAL_PRODUCTION_DATABASE_ROUTE_V1), /^[a-f0-9]{64}$/);
for (const [key, value] of [["connectionMode", "DIRECT"], ["pgHost", "db.xcbnxzjlsvtgzixurcof.supabase.co"], ["pgPort", "6543"], ["pgDatabase", "other"], ["pgUser", "postgres.aaaaaaaaaaaaaaaaaaaa"]]) {
  assert.throws(() => validateProductionDatabaseRouteV1({ ...CANONICAL_PRODUCTION_DATABASE_ROUTE_V1, [key]: value }), /PRODUCTION_DATABASE_ROUTE_AUTHORITY_INVALID/);
}
console.log("R6_PRODUCTION_TARGET_IDENTITY_V2_UNIT_PASS");
