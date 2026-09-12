import assert from "node:assert/strict";

let runLocalSchemaV1Import;
try {
  ({ runLocalSchemaV1Import } = await import("../devices/import-device-schema-v1.mjs"));
} catch (error) {
  const blocker = new Error("LOCAL_SCHEMA_V1_IMPORTER_MISSING: runLocalSchemaV1Import is not implemented");
  blocker.cause = error;
  throw blocker;
}

function importPlan({ blocker = false } = {}) {
  const rows = [
    ["definition", "display.refresh_rate", { key: "display.refresh_rate", valueType: "number" }],
    ["device", "example-viewer", { slug: "example-viewer", schemaType: "display_ar" }],
    ["source", "https://example.test/source", { url: "https://example.test/source", publisher: "Example" }],
    ["sourceLink", "example-viewer\u0000https://example.test/source", { deviceSlug: "example-viewer", sourceUrl: "https://example.test/source" }],
    ["spec", "example-viewer\u0000display.refresh_rate\u0000Global\u0000", { deviceSlug: "example-viewer", definitionKey: "display.refresh_rate", state: "KNOWN" }],
    ["evidence", "example-viewer\u0000display.refresh_rate\u0000https://example.test/source\u0000120", { deviceSlug: "example-viewer", definitionKey: "display.refresh_rate", sourceUrl: "https://example.test/source", claimedValue: 120 }],
  ];
  return {
    delete: "NONE",
    entries: rows.map(([entity, key, desired]) => ({
      entity, key, desired, existing: null, operation: blocker && entity === "device" ? "BLOCKED" : "INSERT",
      blockers: blocker && entity === "device" ? [{ code: "RAY_BAN_IDENTITY_INDETERMINATE" }] : [],
    })),
  };
}

function fakeClient({ failEntity } = {}) {
  const state = { definition: [], device: [], source: [], sourceLink: [], spec: [], evidence: [] };
  return {
    state,
    async transaction(work) {
      const before = structuredClone(state);
      try {
        return await work({
          async upsert(entity, row) {
            if (entity === failEntity) throw new Error(`simulated ${entity} failure`);
            state[entity].push(row);
          },
        });
      } catch (error) {
        for (const key of Object.keys(state)) state[key] = before[key];
        throw error;
      }
    },
  };
}

let clientCreations = 0;
await assert.rejects(
  () => runLocalSchemaV1Import({
    target: "https://project.supabase.co",
    plan: importPlan(),
    createClient: async () => { clientCreations += 1; return fakeClient(); },
  }),
  /Refusing non-local Supabase replay target/,
  "a remote target is rejected before the importer can create a client",
);
assert.equal(clientCreations, 0, "remote rejection happens before client creation");

const failedClient = fakeClient({ failEntity: "evidence" });
await assert.rejects(
  () => runLocalSchemaV1Import({
    target: "http://127.0.0.1:54321",
    plan: importPlan(),
    createClient: async () => failedClient,
  }),
  /simulated evidence failure/,
  "an error in the final dependent write rejects the whole transaction",
);
assert.deepEqual(failedClient.state, {
  definition: [], device: [], source: [], sourceLink: [], spec: [], evidence: [],
}, "a transaction error rolls back definitions, devices, sources, links, specs, and evidence");

let blockedClientCreations = 0;
await assert.rejects(
  () => runLocalSchemaV1Import({
    target: "http://localhost:54321",
    plan: importPlan({ blocker: true }),
    createClient: async () => { blockedClientCreations += 1; return fakeClient(); },
  }),
  /BLOCKED_RECOVERY_PLAN/,
  "a blocker refuses an apply before any database client is created",
);
assert.equal(blockedClientCreations, 0, "a blocked recovery plan cannot begin a write transaction");

console.log("DEVICE_SCHEMA_V1_LOCAL_RECOVERY_OK cases=3 rollback_entities=6");
