import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertLocalReplayTarget } from "../qa/local-disposable-supabase-replay.mjs";
import { buildDeviceRows } from "../migrate-static-device-catalog-to-supabase.mjs";
import { buildLegacyCompatibility } from "./schema-v1/compatibility.mjs";
import { classifyConflicts, loadConflictMappings } from "./schema-v1/conflicts.mjs";
import { buildDefinitionRegistry } from "./schema-v1/definitions.mjs";
import { buildRecoveryPlan, fingerprintRecoveryPlan } from "./schema-v1/dry-run.mjs";
import { resolveIdentityMappings } from "./schema-v1/identity.mjs";
import { buildNormalizedModel } from "./schema-v1/model.mjs";
import { normalizeCatalogYaml } from "./schema-v1/normalize.mjs";
import { loadSourceMetadata, validateSourceMetadata } from "./schema-v1/sources.mjs";
import { loadApprovedDeviceYaml } from "./schema-v1/yaml-input.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENTITY_WRITE_ORDER = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence"]);
const WRITABLE_OPERATIONS = new Set(["INSERT", "UPDATE"]);

function targetHost(target) {
  return new URL(target).hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function assertWritablePlan(plan) {
  if (!plan || !Array.isArray(plan.entries)) throw new TypeError("Recovery plan must contain entries");
  if (plan.delete !== "NONE") throw new Error("Recovery plan must declare DELETE=NONE");
  const blockers = plan.entries.filter((entry) => entry?.operation === "BLOCKED");
  if (blockers.length) throw new Error(`BLOCKED_RECOVERY_PLAN blockers=${blockers.length}`);
  const conflicts = plan.entries.filter((entry) => entry?.operation === "CONFLICT");
  if (conflicts.length) throw new Error(`CONFLICT_RECOVERY_PLAN conflicts=${conflicts.length}`);
}

function writesFor(plan) {
  const byEntity = new Map(ENTITY_WRITE_ORDER.map((entity) => [entity, []]));
  for (const entry of plan.entries) {
    if (!WRITABLE_OPERATIONS.has(entry?.operation)) continue;
    if (!byEntity.has(entry.entity)) throw new Error(`Unsupported recovery-plan entity: ${entry.entity}`);
    if (!entry.desired || typeof entry.desired !== "object") throw new Error(`Writable ${entry.entity} entry has no desired row`);
    byEntity.get(entry.entity).push(entry);
  }
  return ENTITY_WRITE_ORDER.flatMap((entity) => byEntity.get(entity));
}

/**
 * Apply an already-reviewed recovery plan only through a caller-provided local
 * transaction adapter. The adapter contract is transaction(work), where work
 * receives upsert(entity, row); no DELETE or TRUNCATE operation exists here.
 */
export async function runLocalSchemaV1Import({ target, plan, createClient }) {
  // Keep this validation before both blocker handling and client construction:
  // an accidental remote target must have no observable connection attempt.
  assertLocalReplayTarget(target);
  assertWritablePlan(plan);
  if (typeof createClient !== "function") throw new TypeError("A local transaction client factory is required");

  const client = await createClient(target);
  if (!client || typeof client.transaction !== "function") throw new TypeError("Local transaction client must implement transaction(work)");
  const writes = writesFor(plan);
  await client.transaction(async (transaction) => {
    if (!transaction || typeof transaction.upsert !== "function") throw new TypeError("Local transaction must implement upsert(entity, row)");
    for (const entry of writes) await transaction.upsert(entry.entity, entry.desired);
  });

  const operations = Object.fromEntries(ENTITY_WRITE_ORDER.map((entity) => [entity, 0]));
  for (const entry of writes) operations[entry.entity] += 1;
  return Object.freeze({
    format: "openglass-device-schema-v1-local-recovery-receipt-v1",
    targetHost: targetHost(target),
    planFingerprint: fingerprintRecoveryPlan(plan),
    delete: "NONE",
    operations: Object.freeze(operations),
  });
}

async function buildSchemaV1RecoveryPlan() {
  const schemaRoot = path.join(REPOSITORY_ROOT, "scripts", "devices", "schema-v1");
  const approved = await loadApprovedDeviceYaml(path.join(REPOSITORY_ROOT, "src", "data", "devices", "openglasshub_device_data_v1.yaml"));
  const normalized = normalizeCatalogYaml(approved);
  const definitions = buildDefinitionRegistry(normalized);
  const sourceMetadata = await loadSourceMetadata(path.join(schemaRoot, "source-metadata.json"));
  const sourceCheck = validateSourceMetadata({
    sourceUrls: normalized.devices.flatMap((device) => device.evidence.sourceUrls), metadata: sourceMetadata,
  });
  if (sourceCheck.unmappedSourceUrls.length || sourceCheck.ambiguousSourceUrls.length || sourceCheck.invalidRecords.length) {
    throw new Error("BLOCKED_SOURCE_METADATA");
  }
  const [bootstrapRows, mappings, conflictMappings] = await Promise.all([
    buildDeviceRows(),
    readFile(path.join(schemaRoot, "identity-map.json"), "utf8").then((text) => JSON.parse(text).mappings),
    loadConflictMappings(path.join(schemaRoot, "conflict-map.json")),
  ]);
  const identityMappings = resolveIdentityMappings({ yamlDevices: approved.devices, bootstrapRows, mappings });
  const conflicts = classifyConflicts({ normalized, mappings: conflictMappings });
  const model = buildNormalizedModel({ normalized, definitions, sourceMetadata, identityMappings, conflicts });
  const compatibility = model.devices.map((device) => {
    const source = normalized.devices.find((candidate) => candidate.identity.brand === device.brand
      && candidate.identity.model === device.model && candidate.identity.generation === device.generation);
    return Object.freeze({ deviceSlug: device.slug, ...buildLegacyCompatibility(source) });
  });
  return buildRecoveryPlan({
    model: { ...model, compatibility },
    existing: { definitions: [], devices: [], specs: [], sources: [], sourceLinks: [], evidence: [], compatibility: [] },
  });
}

async function loadLocalTransactionClient(target) {
  const adapterPath = process.env.OPENGLASS_LOCAL_SCHEMA_V1_TRANSACTION_CLIENT_MODULE;
  if (!adapterPath) throw new Error("--apply-local requires OPENGLASS_LOCAL_SCHEMA_V1_TRANSACTION_CLIENT_MODULE for an owned local transaction adapter");
  const module = await import(pathToFileURL(path.resolve(adapterPath)).href);
  if (typeof module.createLocalTransactionClient !== "function") throw new Error("Local transaction adapter must export createLocalTransactionClient(target)");
  return module.createLocalTransactionClient(target);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--dry-run", "--apply-local"].includes(args[0])) {
    throw new Error("Use exactly one of --dry-run or --apply-local; remote and production options are forbidden");
  }
  const plan = await buildSchemaV1RecoveryPlan();
  if (args[0] === "--dry-run") {
    const blocked = plan.entries.filter((entry) => entry.operation === "BLOCKED").length;
    const conflicts = plan.entries.filter((entry) => entry.operation === "CONFLICT").length;
    console.log(JSON.stringify({ mode: "dry-run", delete: plan.delete, fingerprint: fingerprintRecoveryPlan(plan), blocked, conflicts }));
    if (blocked || conflicts) process.exitCode = 1;
    return;
  }
  const target = process.env.OPENGLASS_LOCAL_SCHEMA_V1_TARGET;
  if (!target) throw new Error("--apply-local requires OPENGLASS_LOCAL_SCHEMA_V1_TARGET");
  const receipt = await runLocalSchemaV1Import({ target, plan, createClient: loadLocalTransactionClient });
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`DEVICE_SCHEMA_V1_LOCAL_IMPORT_FAIL ${error.message}`); process.exitCode = 1; });
}
