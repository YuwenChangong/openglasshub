import assert from "node:assert/strict";

let productionTransport;
try {
  productionTransport = await import("./lib/release-b-production-transport.mjs");
} catch (error) {
  assert.equal(error?.code, "ERR_MODULE_NOT_FOUND", "the RED failure must be the missing reviewed production transport module");
  throw error;
}

assert.throws(
  () => productionTransport.createReleaseBProductionTransport({ createSession: async () => ({}) }),
  /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
  "a Production transport without the existing approved DSN source fails closed before any session is opened",
);

const environment = { P9_PRODUCTION_DATABASE_URL: "postgresql://postgres:unit-test-password@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require" };
function sessionFactory({ identity = { current_database: "postgres", current_user: "postgres" }, state = { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: { devices: 0, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 } }, failOn = null } = {}) {
  const queries = [];
  return {
    queries,
    async createSession() {
      return {
        async query(sql) {
          queries.push(sql);
          if (failOn && sql === failOn.sql) throw Object.assign(new Error("simulated native loss"), { code: failOn.code });
          if (sql.startsWith("SELECT current_database")) return { rows: [identity] };
          if (sql.startsWith("LOCK TABLE")) return { rows: [{ release_b_state: state }] };
          return { rows: [] };
        },
        async close() {},
      };
    },
  };
}

const happy = sessionFactory();
const transport = productionTransport.createReleaseBProductionTransport({
  environment,
  createSession: happy.createSession,
  renderAuthorizedOperation: ({ entity }) => entity === "device" ? "INSERT INTO public.devices (slug) VALUES ('unit');" : "DELETE FROM public.devices;",
  readPostcheck: async () => ({ verified: true }),
});
assert.deepEqual(await transport.identifyTarget(), { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" }, "validated endpoint and read-only database identity bind the fixed target before any write");
await transport.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); });
assert.ok(happy.queries.some((sql) => sql.startsWith("LOCK TABLE public.devices")), "the final precheck locks all seven allowed relations in the mutation transaction");
assert.ok(happy.queries.includes("COMMIT;"), "a valid structured operation commits once");

for (const [name, operation, expected, forbiddenSql] of [
  ["out-of-scope table", ({ entity }) => entity === "device" ? "INSERT INTO public.unapproved_table (id) VALUES (1);" : "", /WRITE_SCOPE_VIOLATION/, /INSERT INTO public\.unapproved_table/i],
  ["delete", () => "DELETE FROM public.devices;", /WRITE_FORBIDDEN/, /^DELETE FROM public\.devices/i],
  ["DDL", () => "ALTER TABLE public.devices ADD COLUMN nope text;", /WRITE_FORBIDDEN/, /^ALTER TABLE public\.devices/i],
  ["migration history", () => "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('x');", /WRITE_FORBIDDEN/, /^INSERT INTO supabase_migrations/i],
]) {
  const fake = sessionFactory();
  const rejected = productionTransport.createReleaseBProductionTransport({ environment, createSession: fake.createSession, renderAuthorizedOperation: operation, readPostcheck: async () => ({}) });
  await assert.rejects(() => rejected.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: name }); }), expected, `${name} is rejected by the transport before SQL execution`);
  assert.equal(fake.queries.some((sql) => forbiddenSql.test(sql)), false, `${name} is never sent to the session`);
}

const wrongTarget = sessionFactory({ identity: { current_database: "postgres", current_user: "wrong-user" } });
const mismatch = productionTransport.createReleaseBProductionTransport({ environment, createSession: wrongTarget.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => mismatch.identifyTarget(), /RELEASE_B_TARGET_MISMATCH/, "a database identity mismatch fails before a transaction can start");
const unsafePostcheck = productionTransport.createReleaseBProductionTransport({ environment, createSession: happy.createSession, readPostcheck: async ({ queryReadOnly }) => queryReadOnly("UPDATE public.devices SET name = 'nope';") });
await assert.rejects(() => unsafePostcheck.readPostcheck(), /RELEASE_B_PRODUCTION_READ_ONLY_VIOLATION/, "post-commit verification cannot become a hidden write escape hatch");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "AFTER_BEGIN_BEFORE_FIRST_WRITE"), "RELEASE_B_SAFE_FAILURE");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "AFTER_FIRST_WRITE_BEFORE_COMMIT"), "TRANSPORT_AFTER_FIRST_WRITE");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "COMMIT_SENT_ACK_NOT_RECEIVED"), "COMMIT_UNKNOWN");
const lostAfterWrite = sessionFactory({ failOn: { sql: "INSERT INTO public.devices (slug) VALUES ('unit');", code: "ECONNRESET" } });
const uncertainWrite = productionTransport.createReleaseBProductionTransport({ environment, createSession: lostAfterWrite.createSession, renderAuthorizedOperation: () => "INSERT INTO public.devices (slug) VALUES ('unit');", readPostcheck: async () => ({}) });
await assert.rejects(() => uncertainWrite.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); }), /TRANSPORT_AFTER_FIRST_WRITE/, "a connection loss while a write is in flight is consumed and never classified as a safe rollback");
const metadata = productionTransport.preflightReleaseBProductionTransport({ environment, createSession: happy.createSession, readPostcheck: async () => ({}) });
assert.deepEqual([metadata.credentialSource, metadata.connects, metadata.startsTransaction, metadata.runsSql], ["P9_PRODUCTION_DATABASE_URL", false, false, false], "preflight is value-blind metadata validation and performs no I/O");
const executor = await import("./release-b-production-import.mjs");
const executorPreflight = executor.preflightReleaseBProductionImport({ environment });
assert.deepEqual([executorPreflight.moduleInterfaceComplete, executorPreflight.injectionComplete, executorPreflight.executorRequiresExplicitTransportInjection, executorPreflight.authorizationConsumed, executorPreflight.productionConnections], [true, false, true, false, 0], "executor preflight validates wiring without enabling a Production session or authorization consumption");

console.log("RELEASE_B_PRODUCTION_TRANSPORT_UNIT_OK");
