import assert from "node:assert/strict";
import { validateRuntimeRoutingBeforeSqlClient } from "./qa/r6-production-reconciliation-transport.mjs";
import { CANONICAL_PRODUCTION_DATABASE_ROUTE_V1 } from "./lib/r6-production-target-identity-v2.mjs";

const correct = { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" };
assert.equal(validateRuntimeRoutingBeforeSqlClient({ routeAuthority: CANONICAL_PRODUCTION_DATABASE_ROUTE_V1, environment: correct }).targetMatch, true);
for (const [key, value] of [["PGHOST", "attacker.example"], ["PGPORT", "6543"], ["PGDATABASE", "other"], ["PGUSER", "postgres.aaaaaaaaaaaaaaaaaaaa"], ["PGUSER", undefined]]) {
  assert.throws(() => validateRuntimeRoutingBeforeSqlClient({ routeAuthority: CANONICAL_PRODUCTION_DATABASE_ROUTE_V1, environment: { ...correct, [key]: value } }), /RUNTIME_ROUTE_AUTHORITY_MISMATCH/);
}
console.log("R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PRECLIENT_UNIT_PASS");
