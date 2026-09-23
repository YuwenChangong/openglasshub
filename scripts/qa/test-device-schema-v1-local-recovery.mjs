import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPublishedDeviceBySlug, listPublishedDevices } from "../../src/lib/public-device-data.ts";
import { createInMemoryTransactionClient } from "../../tests/fixtures/device-schema-v1/in-memory-transaction-client.mjs";

let runLocalSchemaV1Import, buildSchemaV1RecoveryPlan;
try {
  ({ runLocalSchemaV1Import, buildSchemaV1RecoveryPlan } = await import("../devices/import-device-schema-v1.mjs"));
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

function readerClient(rows) {
  const filters = [];
  const result = () => rows.filter((row) => filters.every(([key, value]) => row[key] === value));
  const query = {
    select() { return query; },
    eq(key, value) { filters.push([key, value]); return query; },
    order() { return Promise.resolve({ data: result(), error: null }); },
    maybeSingle() { return Promise.resolve({ data: result()[0] ?? null, error: null }); },
  };
  return { from() { return query; } };
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

let malformedClientCreations = 0;
const malformedPlan = importPlan();
malformedPlan.entries[0] = { ...malformedPlan.entries[0], desired: null };
await assert.rejects(
  () => runLocalSchemaV1Import({
    target: "http://localhost:54321",
    plan: malformedPlan,
    createClient: async () => { malformedClientCreations += 1; return fakeClient(); },
  }),
  /Writable definition entry has no desired row/,
  "a malformed writable entry is rejected before a local client is created",
);
assert.equal(malformedClientCreations, 0, "malformed writable data cannot start a client connection");

const reusableFixture = await createInMemoryTransactionClient();
const firstRecoveryPlan = await buildSchemaV1RecoveryPlan();
await runLocalSchemaV1Import({
  target: "http://localhost:54321",
  plan: firstRecoveryPlan,
  createClient: async () => reusableFixture,
});
const actualRerunPlan = await buildSchemaV1RecoveryPlan({ existing: reusableFixture.snapshot() });
assert.ok(actualRerunPlan.entries.every((entry) => entry.operation === "UNCHANGED"), "the actual imported snapshot derives an all-UNCHANGED rerun plan");
const noOverwriteReceipt = await runLocalSchemaV1Import({
  target: "http://localhost:54321",
  plan: actualRerunPlan,
  createClient: async () => reusableFixture,
});
assert.deepEqual(noOverwriteReceipt.operations, {
  definition: 0, device: 0, source: 0, sourceLink: 0, spec: 0, evidence: 0, compatibility: 0,
}, "an actual rerun against the imported fixture records zero writes");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dryRun = spawnSync(process.execPath, ["scripts/devices/import-device-schema-v1.mjs", "--dry-run"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(dryRun.status, 0, `the full approved catalog dry run reports a plan instead of crashing: ${dryRun.stderr}`);
const dryRunPlan = JSON.parse(dryRun.stdout);
assert.equal(dryRunPlan.mode, "dry-run");
assert.equal(dryRunPlan.delete, "NONE");
assert.equal(dryRunPlan.blocked, 0, "reviewed evidence mappings unblock the approved catalog before a local transaction can begin");

const expected = JSON.parse(await readFile(path.join(root, "tests/fixtures/device-schema-v1/local-recovery-expected.json"), "utf8"));
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "openglass-schema-v1-local-"));
const snapshotPath = path.join(temporaryDirectory, "snapshot.json");
try {
  const applied = spawnSync(process.execPath, ["scripts/devices/import-device-schema-v1.mjs", "--apply-local"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENGLASS_LOCAL_SCHEMA_V1_TARGET: "http://127.0.0.1:54321",
      OPENGLASS_LOCAL_SCHEMA_V1_TRANSACTION_CLIENT_MODULE: path.join(root, "tests/fixtures/device-schema-v1/in-memory-transaction-client.mjs"),
      OPENGLASS_LOCAL_SCHEMA_V1_SNAPSHOT_PATH: snapshotPath,
    },
  });
  assert.equal(applied.status, 0, `the approved catalog imports into the owned disposable transaction fixture: ${applied.stderr}`);
  const receipt = JSON.parse(applied.stdout);
  assert.equal(receipt.delete, "NONE");
  assert.deepEqual(receipt.operations, {
    definition: expected.definitions,
    device: expected.devices,
    source: expected.sources,
    sourceLink: expected.sourceLinks,
    spec: expected.specs,
    evidence: expected.evidence,
    compatibility: expected.compatibility,
  }, "the local receipt records every planned non-destructive write");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.devices.length, expected.devices, "the local reader fixture contains all recovered devices");
  assert.equal(new Set(snapshot.devices.map((device) => device.slug)).size, expected.uniqueSlugs, "recovered device slugs are unique");
  assert.equal(snapshot.devices.filter((device) => device.publication_status === "published").length, expected.publishedDevices, "all recovered device rows are visible to legacy readers");
  assert.deepEqual(Object.fromEntries([...snapshot.devices.reduce((counts, device) => {
    counts.set(device.brand_key, (counts.get(device.brand_key) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort()), expected.brandCounts, "the recovered legacy reader rows retain exact product counts by brand");
  for (const slug of ["xreal-one", "ray-ban-meta", "rayneo-x2"]) {
    const device = await getPublishedDeviceBySlug(readerClient(snapshot.devices), slug);
    assert.equal(device?.slug, slug, `legacy /devices/${slug} resolves a published product row for its /products/ redirect`);
  }
  const published = await listPublishedDevices(readerClient(snapshot.devices));
  assert.equal(published.length, expected.publishedDevices, "the imported empty-fixture rows satisfy the public published-device reader");
  assert.ok(published.every((device) => device.keySpecs.length > 0 && device.specGroups.length > 0), "the imported rows carry YAML-derived legacy key/full specs for public readers");
  assert.equal(snapshot.specs.length, expected.specs, "the local reader fixture contains the exact derived spec count");
  assert.equal(snapshot.sources.length, expected.sources, "the local reader fixture contains reviewed sources");
  assert.equal(snapshot.evidence.length, expected.evidence, "the local reader fixture contains field-level evidence claims");
  assert.equal(snapshot.compatibility.length, expected.compatibility, "every recovered device has YAML-derived legacy compatibility payload");
  assert.equal(new Set(snapshot.specs.map((spec) => `${spec.deviceSlug}\u0000${spec.definitionKey}\u0000${spec.region}\u0000${spec.variant}`)).size, expected.specs, "recovery has no duplicate device/spec contexts");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("DEVICE_SCHEMA_V1_LOCAL_RECOVERY_OK cases=7 rollback_entities=6");
