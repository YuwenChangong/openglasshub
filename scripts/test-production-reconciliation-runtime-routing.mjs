import assert from "node:assert/strict";
import { validateRuntimeRoutingBeforeSqlClient } from "./qa/r6-production-reconciliation-transport.mjs";

const correct = { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" };
assert.equal(validateRuntimeRoutingBeforeSqlClient({ expectedProjectRef: "xcbnxzjlsvtgzixurcof", environment: correct }).targetMatch, true);
assert.throws(() => validateRuntimeRoutingBeforeSqlClient({ expectedProjectRef: "xcbnxzjlsvtgzixurcof", environment: { ...correct, PGUSER: "postgres.aaaaaaaaaaaaaaaaaaaa" } }), /RUNTIME_ROUTING_PROJECT_REF_MISMATCH/);
for (const pgUser of [undefined, null, "", "postgres", "postgres.", ".postgres", "postgres..xcbnxzjlsvtgzixurcof", "postgres.xcbnxzjlsvtgzixurcof.extra", "postgres/xcbnxzjlsvtgzixurcof", "postgres:xcbnxzjlsvtgzixurcof"]) {
  assert.throws(() => validateRuntimeRoutingBeforeSqlClient({ expectedProjectRef: "xcbnxzjlsvtgzixurcof", environment: { ...correct, PGUSER: pgUser } }), /RUNTIME_ROUTING_IDENTITY_INVALID/);
}
console.log("R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PRECLIENT_UNIT_PASS");
