import assert from "node:assert/strict";

let productionTransport;
try {
  productionTransport = await import("./lib/release-b-production-transport.mjs");
} catch (error) {
  assert.equal(error?.code, "ERR_MODULE_NOT_FOUND", "the RED failure must be the missing reviewed production transport module");
  throw error;
}

assert.throws(
  () => productionTransport.createReleaseBProductionTransport({ environment: {}, createSession: async () => ({}), readPostcheck: async () => ({}) }),
  /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
  "a Production transport without the existing approved DSN source fails closed before any session is opened",
);

const environment = { P9_PRODUCTION_DATABASE_URL: "postgresql://postgres:unit-test-password@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require" };
function sessionFactory({ identity = { current_database: "postgres", current_user: "postgres", server_port: "5432" }, targetIdentity = { projectRef: "xcbnxzjlsvtgzixurcof", host: "db.xcbnxzjlsvtgzixurcof.supabase.co", port: 5432 }, state = { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: { devices: 0, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 } }, failOn = null, compatibilityResult = { rows: [{ updated: 1 }], rowCount: 1 } } = {}) {
  const queries = [];
  return {
    queries,
    async createSession() {
      return {
        targetIdentity,
        async query(sql) {
          queries.push(sql);
          if (failOn && sql.startsWith(failOn.sql)) throw Object.assign(new Error("simulated native loss"), { code: failOn.code });
          if (sql.startsWith("SELECT current_database")) return { rows: [identity] };
          if (sql.startsWith("LOCK TABLE")) return { rows: [{ release_b_state: state }] };
          if (sql.startsWith("UPDATE public.devices") && sql.includes(" RETURNING 1 AS updated")) return compatibilityResult;
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
  readPostcheck: async () => ({ verified: true }),
});
assert.deepEqual(await transport.identifyTarget(), { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" }, "validated endpoint and read-only database identity bind the fixed target before any write");
await transport.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); });
assert.equal(happy.queries.includes("BEGIN;\nSET CONSTRAINTS ALL DEFERRED;"), false, "the actual adapter sends transaction control as discrete session statements");
assert.ok(happy.queries.some((sql) => sql.startsWith("LOCK TABLE public.devices")), "the final precheck locks all seven allowed relations in the mutation transaction");
assert.ok(happy.queries.includes("COMMIT;"), "a valid structured operation commits once");

const compatibilitySession = sessionFactory();
const compatibilityTransport = productionTransport.createReleaseBProductionTransport({
  environment,
  createSession: compatibilitySession.createSession,
  readPostcheck: async () => ({}),
});
await compatibilityTransport.transaction(async (transaction) => {
  await transaction.readPrecheckForUpdate();
  await transaction.upsert("compatibility", { deviceSlug: "unit", key_specs: {}, full_specs: {} });
});
const compatibilityWrite = compatibilitySession.queries.find((sql) => /public\.devices/i.test(sql) && !sql.startsWith("LOCK TABLE"));
assert.match(compatibilityWrite, /^UPDATE public\.devices\s+SET/i, "compatibility mutation is a single table-scoped UPDATE, never a procedural DO body");
assert.doesNotMatch(compatibilityWrite, /\bDO\b|;[\s\S]*\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|CREATE)\b/i, "compatibility mutation cannot hide additional statements inside a DO body");
assert.match(compatibilityWrite, /RETURNING 1 AS updated;$/, "compatibility mutation proves the target device row exists");
const missingCompatibilitySession = sessionFactory({ compatibilityResult: { rows: [], rowCount: 0 } });
const missingCompatibility = productionTransport.createReleaseBProductionTransport({
  environment,
  createSession: missingCompatibilitySession.createSession,
  readPostcheck: async () => ({}),
});
await assert.rejects(() => missingCompatibility.transaction(async (transaction) => {
  await transaction.readPrecheckForUpdate();
  await transaction.upsert("compatibility", { deviceSlug: "missing", key_specs: {}, full_specs: {} });
}), /RELEASE_B_COMPATIBILITY_DEVICE_MISSING/, "compatibility update fails closed when the target device row is absent");

for (const [name, operation] of [
  ["out-of-scope table", () => "INSERT INTO public.unapproved_table (id) VALUES (1);"],
  ["delete", () => "DELETE FROM public.devices;"],
  ["DDL", () => "ALTER TABLE public.devices ADD COLUMN nope text;"],
  ["migration history", () => "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('x');"],
  ["second unapproved statement", () => "INSERT INTO public.devices (slug) VALUES ('unit'); UPDATE public.unapproved_table SET id = 1;"],
  ["compatibility DO body bypass", () => "DO $openglass_compat$ BEGIN UPDATE public.unapproved_table SET id = 1; END $openglass_compat$;"],
]) {
  const fake = sessionFactory();
  assert.throws(() => productionTransport.createReleaseBProductionTransport({ environment, createSession: fake.createSession, renderAuthorizedOperation: operation, readPostcheck: async () => ({}) }), /RELEASE_B_PRODUCTION_RENDERER_INJECTION_FORBIDDEN/, `${name} cannot inject a raw renderer into the actual adapter`);
  assert.equal(fake.queries.length, 0, `${name} cannot execute SQL while attempting renderer injection`);
}

const wrongTarget = sessionFactory({ identity: { current_database: "postgres", current_user: "wrong-user", server_port: "5432" } });
const mismatch = productionTransport.createReleaseBProductionTransport({ environment, createSession: wrongTarget.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => mismatch.identifyTarget(), /RELEASE_B_TARGET_MISMATCH/, "a database identity mismatch fails before a transaction can start");
assert.equal(wrongTarget.queries.length, 1, "identify-target mismatch performs exactly one identity query");
const sameDatabaseWrongProject = sessionFactory({ targetIdentity: { projectRef: "other-project", host: "db.other-project.supabase.co", port: 5432 } });
const independentMismatch = productionTransport.createReleaseBProductionTransport({ environment, createSession: sameDatabaseWrongProject.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => independentMismatch.identifyTarget(), /RELEASE_B_TARGET_MISMATCH/, "a matching database and user without the expected project-bound connection identity fails closed before a transaction");
assert.equal(sameDatabaseWrongProject.queries.length, 1, "project identity mismatch performs exactly one identity query");
let identifyConnectAttempts = 0;
const connectFailureTransport = productionTransport.createReleaseBProductionTransport({
  environment,
  createSession: async () => {
    identifyConnectAttempts += 1;
    throw Object.assign(new Error("identify session connect lost"), { code: "ECONNREFUSED" });
  },
  readPostcheck: async () => ({}),
});
await assert.rejects(() => connectFailureTransport.identifyTarget(), /identify session connect lost/, "identify-target connection failure is preserved before transaction");
assert.equal(identifyConnectAttempts, 1, "identify-target connection failure is not retried");
const identifyAuthFailure = sessionFactory({ failOn: { sql: "SELECT current_database", code: "28P01" } });
const authFailureTransport = productionTransport.createReleaseBProductionTransport({ environment, createSession: identifyAuthFailure.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => authFailureTransport.identifyTarget(), (error) => error.code === "28P01", "identify-target authentication failure preserves SQLSTATE before transaction");
assert.equal(identifyAuthFailure.queries.length, 1, "identify-target authentication failure is not retried");
const unsafePostcheck = productionTransport.createReleaseBProductionTransport({ environment, createSession: happy.createSession, readPostcheck: async ({ queryReadOnly }) => queryReadOnly("UPDATE public.devices SET name = 'nope';") });
await assert.rejects(() => unsafePostcheck.readPostcheck(), /RELEASE_B_PRODUCTION_READ_ONLY_VIOLATION/, "post-commit verification cannot become a hidden write escape hatch");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "BEFORE_BEGIN"), "RELEASE_B_SAFE_FAILURE_BEFORE_BEGIN");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "AFTER_BEGIN_BEFORE_FIRST_WRITE"), "RELEASE_B_SAFE_FAILURE_BEFORE_FIRST_WRITE");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "AFTER_FIRST_WRITE_BEFORE_COMMIT"), "TRANSPORT_AFTER_FIRST_WRITE");
assert.equal(productionTransport.classifyReleaseBConnectionFailure({ code: "ECONNRESET" }, "COMMIT_SENT_ACK_NOT_RECEIVED"), "COMMIT_UNKNOWN");
assert.equal(productionTransport.classifyReleaseBConnectionFailure(new Error("connection terminated unexpectedly"), "AFTER_FIRST_WRITE_BEFORE_COMMIT"), "TRANSPORT_AFTER_FIRST_WRITE");
const lostAfterWrite = sessionFactory({ failOn: { sql: "INSERT INTO public.devices", code: "ECONNRESET" } });
const uncertainWrite = productionTransport.createReleaseBProductionTransport({ environment, createSession: lostAfterWrite.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => uncertainWrite.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); }), /TRANSPORT_AFTER_FIRST_WRITE/, "a connection loss while a write is in flight is consumed and never classified as a safe rollback");
const lostBeforeBegin = productionTransport.createReleaseBProductionTransport({ environment, createSession: async () => { throw Object.assign(new Error("session open lost"), { code: "ECONNRESET" }); }, readPostcheck: async () => ({}) });
await assert.rejects(() => lostBeforeBegin.transaction(async () => {}), /RELEASE_B_SAFE_FAILURE_BEFORE_BEGIN/, "a native connection loss while opening the session is phase-aware and safe before BEGIN");
const commitAckLoss = sessionFactory({ failOn: { sql: "COMMIT;", code: "ECONNRESET" } });
const commitUnknown = productionTransport.createReleaseBProductionTransport({ environment, createSession: commitAckLoss.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => commitUnknown.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); }), /COMMIT_UNKNOWN/, "a lost commit acknowledgement remains execution-ambiguous for the executor");
assert.equal(commitAckLoss.queries.filter((sql) => sql === "COMMIT;").length, 1, "lost commit acknowledgement is not retried");
assert.equal(commitAckLoss.queries.includes("ROLLBACK;"), false, "lost commit acknowledgement never claims rollback");
const deterministicFailure = sessionFactory({ failOn: { sql: "INSERT INTO public.devices", code: "23514" } });
const deterministicTransport = productionTransport.createReleaseBProductionTransport({ environment, createSession: deterministicFailure.createSession, readPostcheck: async () => ({}) });
await assert.rejects(() => deterministicTransport.transaction(async (transaction) => { await transaction.readPrecheckForUpdate(); await transaction.upsert("device", { slug: "unit" }); }), (error) => error.code === "23514" && deterministicFailure.queries.at(-1) === "ROLLBACK;", "a deterministic SQL failure preserves its SQLSTATE after an acknowledged rollback");
const postcheckProviderLoss = sessionFactory({ failOn: { sql: "SELECT 1", code: "57P01" } });
const postcheckLossTransport = productionTransport.createReleaseBProductionTransport({
  environment,
  createSession: postcheckProviderLoss.createSession,
  readPostcheck: async ({ queryReadOnly }) => queryReadOnly("SELECT 1", []),
});
await assert.rejects(() => postcheckLossTransport.readPostcheck(), (error) => error.code === "57P01", "postcheck provider loss is preserved for executor ambiguity mapping");
assert.equal(postcheckProviderLoss.queries.filter((sql) => sql === "SELECT 1").length, 1, "postcheck provider loss is not retried");
const metadata = productionTransport.preflightReleaseBProductionTransport({ environment, createSession: happy.createSession, readPostcheck: async () => ({}) });
assert.deepEqual([metadata.credentialSource, metadata.connects, metadata.startsTransaction, metadata.runsSql], ["P9_PRODUCTION_DATABASE_URL", false, false, false], "preflight is value-blind metadata validation and performs no I/O");
const executor = await import("./release-b-production-import.mjs");
const executorPreflight = executor.preflightReleaseBProductionImport({ environment });
assert.deepEqual([executorPreflight.moduleInterfaceComplete, executorPreflight.injectionComplete, executorPreflight.executorRequiresExplicitTransportInjection, executorPreflight.authorizationConsumed, executorPreflight.productionConnections], [true, false, true, false, 0], "executor preflight validates wiring without enabling a Production session or authorization consumption");

console.log("RELEASE_B_PRODUCTION_TRANSPORT_UNIT_OK");
