import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPublishedDeviceBySlug, listPublishedDevices } from "../../src/lib/public-device-data.ts";
import { buildSchemaV1RecoveryPlan, runLocalSchemaV1Import } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";
import {
  createDisposablePostgresTransactionClient,
  readSchemaV1SqlState,
  readSchemaV1SqlVerification,
} from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";
import { runLocalDisposableReplay } from "./local-disposable-supabase-replay.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXACT_COUNTS = Object.freeze({
  devices: 24,
  uniqueSlugs: 24,
  published: 24,
  definitions: 92,
  specs: 1488,
  sources: 39,
  sourceLinks: 46,
  evidence: 15,
  auditEvents: 0,
});
const EXACT_OPERATIONS = Object.freeze({ definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });
const ZERO_OPERATIONS = Object.freeze({ definition: 0, device: 0, source: 0, sourceLink: 0, spec: 0, evidence: 0, compatibility: 0 });

function equalJson(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  if (left && typeof left === "object" || right && typeof right === "object") {
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
  }
  return Object.is(left, right);
}

function exactRecord(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(expected).every((key) => value[key] === expected[key]);
}

export function assertReleaseBSqlRehearsalReceipt(receipt) {
  const counts = receipt?.counts;
  const valid = receipt?.format === "openglass-device-schema-v1-release-b-sql-rehearsal-v1"
    && receipt.status === "PASS"
    && receipt.target === "LOCAL_DISPOSABLE_SQL"
    && receipt.disposableSupabase === true
    && receipt.fullCanonicalMigrationChain === true
    && receipt.releaseASchemaPresent === true
    && receipt.manuallyRecreatedSchemaObjects === 0
    && receipt.yamlDeviceCount === 24
    && receipt.identityMapCount === 24
    && receipt.unresolvedIdentities === 0
    && receipt.unresolvedEvidenceMaps === 0
    && receipt.dryRunBlocked === 0
    && receipt.dryRunDelete === "NONE"
    && receipt.transactionResult === "COMMIT"
    && exactRecord(counts, EXACT_COUNTS)
    && counts.constraintFailures === 0
    && counts.triggerFailures === 0
    && counts.duplicateFailures === 0
    && counts.conflictEvidenceFailures === 0
    && counts.unknownUnverifiedKnownData === 0
    && receipt.sqlConstraintFailures === 0
    && receipt.sqlTriggerFailures === 0
    && receipt.deleteOperations === 0
    && receipt.conflictEvidenceFailures === 0
    && receipt.duplicateFailures === 0
    && receipt.unknownUnverifiedKnownData === 0
    && receipt.legacyYamlDerived === true
    && receipt.invalidPayloadResult === "FAIL"
    && receipt.invalidPayloadSqlState === "23514"
    && receipt.rowsCommittedAfterFailure === 0
    && receipt.transactionRollbackAtomicity === "PASS"
    && receipt.secondRunBlocked === 0
    && receipt.secondRunDelete === "NONE"
    && exactRecord(receipt.secondRunOperations, ZERO_OPERATIONS)
    && receipt.productCompatibilityLocal === "PASS";
  if (!valid) throw new Error("RELEASE_B_SQL_REHEARSAL_RECEIPT_INVALID");
  return true;
}

function writableCounts(plan) {
  const result = { ...ZERO_OPERATIONS };
  for (const entry of plan.entries) if (entry.operation === "INSERT" || entry.operation === "UPDATE") result[entry.entity] += 1;
  return result;
}

function invalidLatePlan(plan) {
  const copy = structuredClone(plan);
  const index = copy.entries.findLastIndex((entry) => entry.entity === "compatibility" && entry.operation === "INSERT");
  if (index < 0) throw new Error("Release B valid payload has no compatibility write to invalidate");
  copy.entries[index].desired = { ...copy.entries[index].desired, full_specs: [] };
  return copy;
}

function rowsCommitted(verification) {
  return verification.devices + verification.definitions + verification.specs + verification.sources
    + verification.sourceLinks + verification.evidence + verification.auditEvents;
}

function readerClient(rows) {
  return {
    from(table) {
      if (table !== "devices") throw new Error(`Unexpected product reader table: ${table}`);
      const filters = [];
      const selected = () => rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order(key, options) {
          const direction = options?.ascending === false ? -1 : 1;
          const data = [...selected()].sort((left, right) => direction * String(left[key]).localeCompare(String(right[key])));
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() { return Promise.resolve({ data: selected()[0] ?? null, error: null }); },
      };
      return query;
    },
  };
}

export function adaptSqlStateForRecoveryPlan(state, validPlan) {
  const desiredCompatibility = new Map(validPlan.entries
    .filter((entry) => entry.entity === "compatibility")
    .map((entry) => [entry.desired.deviceSlug, entry.desired]));
  const desiredSpecs = new Map(validPlan.entries
    .filter((entry) => entry.entity === "spec")
    .map((entry) => [`${entry.desired.deviceSlug}\u0000${entry.desired.definitionKey}\u0000${entry.desired.region}\u0000${entry.desired.variant}`, entry.desired]));
  const desiredEvidence = new Map(validPlan.entries
    .filter((entry) => entry.entity === "evidence")
    .map((entry) => [`${entry.desired.deviceSlug}\u0000${entry.desired.definitionKey}\u0000${entry.desired.sourceUrl}\u0000${String(entry.desired.claimedValue)}`, entry.desired]));
  return {
    definitions: state.definitions,
    devices: state.devices,
    specs: state.specs.map((actual) => {
      const desired = desiredSpecs.get(`${actual.deviceSlug}\u0000${actual.definitionKey}\u0000${actual.region}\u0000${actual.variant}`);
      return desired && String(actual.rawValue) === String(desired.rawValue) ? { ...actual, rawValue: desired.rawValue } : actual;
    }),
    sources: state.sources,
    sourceLinks: state.sourceLinks,
    evidence: state.evidence.map((actual) => {
      const desired = desiredEvidence.get(`${actual.deviceSlug}\u0000${actual.definitionKey}\u0000${actual.sourceUrl}\u0000${String(actual.claimedValue)}`);
      return desired ? { ...actual, claimedValue: desired.claimedValue } : actual;
    }),
    compatibility: state.compatibility.map((actual) => {
      const desired = desiredCompatibility.get(actual.deviceSlug);
      if (!desired) return actual;
      return { ...desired, key_specs: actual.key_specs, full_specs: actual.full_specs };
    }),
  };
}

async function validateProductReader(state, expected) {
  const client = readerClient(state.devices);
  const published = await listPublishedDevices(client);
  if (published.length !== 24 || published.some((device) => device.keySpecs.length === 0 || device.specGroups.length === 0)) return false;
  const brandCounts = Object.fromEntries([...published.reduce((counts, device) => counts.set(device.brandKey, (counts.get(device.brandKey) ?? 0) + 1), new Map()).entries()].sort());
  if (!equalJson(brandCounts, expected.brandCounts)) return false;
  for (const slug of ["xreal-one", "ray-ban-meta", "rayneo-x2"]) {
    if ((await getPublishedDeviceBySlug(readerClient(state.devices), slug))?.slug !== slug) return false;
  }
  return true;
}

export async function runReleaseBSqlRehearsal() {
  const [validPlan, expected, identityMap] = await Promise.all([
    buildSchemaV1RecoveryPlan(),
    readFile(path.join(REPOSITORY_ROOT, "tests/fixtures/device-schema-v1/local-recovery-expected.json"), "utf8").then(JSON.parse),
    readFile(path.join(REPOSITORY_ROOT, "scripts/devices/schema-v1/identity-map.json"), "utf8").then(JSON.parse),
  ]);
  const dryRunBlocked = validPlan.entries.filter((entry) => entry.operation === "BLOCKED").length;
  const unresolvedIdentities = validPlan.entries.filter((entry) => entry.blockers?.some((blocker) => /IDENTITY/.test(blocker.code))).length;
  const unresolvedEvidenceMaps = validPlan.entries.filter((entry) => entry.blockers?.some((blocker) => /(?:SOURCE|EVIDENCE|CONFLICT)/.test(blocker.code))).length;
  if (!exactRecord(writableCounts(validPlan), EXACT_OPERATIONS) || dryRunBlocked !== 0 || validPlan.delete !== "NONE") throw new Error("Release B frozen recovery plan preconditions failed");

  const replay = await runLocalDisposableReplay({
    root: REPOSITORY_ROOT,
    afterMigrationLedgerValidated: async ({ target, canonicalMigrationCount, executeSql }) => {
      let invalidError;
      try {
        await runLocalSchemaV1Import({
          target,
          plan: invalidLatePlan(validPlan),
          createClient: async () => createDisposablePostgresTransactionClient({ executeSql }),
        });
      } catch (error) { invalidError = error; }
      if (!invalidError || invalidError.sqlState !== "23514") throw new Error("Synthetic late payload did not fail through a PostgreSQL CHECK constraint");
      const rollbackVerification = await readSchemaV1SqlVerification({ executeSql });
      const committedAfterFailure = rowsCommitted(rollbackVerification);
      if (committedAfterFailure !== 0) throw new Error(`Release B invalid transaction committed ${committedAfterFailure} rows`);

      const importReceipt = await runLocalSchemaV1Import({
        target,
        plan: validPlan,
        createClient: async () => createDisposablePostgresTransactionClient({ executeSql }),
      });
      if (!exactRecord(importReceipt.operations, EXACT_OPERATIONS)) throw new Error("Release B SQL import operation counts differ from the frozen recovery plan");
      const [state, verification] = await Promise.all([
        readSchemaV1SqlState({ executeSql }),
        readSchemaV1SqlVerification({ executeSql }),
      ]);
      if (!exactRecord(verification, EXACT_COUNTS) || verification.constraintFailures !== 0 || verification.triggerFailures !== 0
        || verification.duplicateFailures !== 0 || verification.conflictEvidenceFailures !== 0 || verification.unknownUnverifiedKnownData !== 0) {
        throw new Error("Release B committed SQL postconditions failed");
      }
      const desiredCompatibility = new Map(validPlan.entries.filter((entry) => entry.entity === "compatibility").map((entry) => [entry.desired.deviceSlug, entry.desired]));
      const legacyYamlDerived = state.compatibility.length === 24 && state.compatibility.every((actual) => {
        const desired = desiredCompatibility.get(actual.deviceSlug);
        return desired && equalJson(actual.key_specs, desired.key_specs) && equalJson(actual.full_specs, desired.full_specs);
      });
      if (!legacyYamlDerived) throw new Error("Release B legacy compatibility columns differ from normalized YAML");

      const secondPlan = await buildSchemaV1RecoveryPlan({ existing: adaptSqlStateForRecoveryPlan(state, validPlan) });
      const secondRunBlocked = secondPlan.entries.filter((entry) => entry.operation === "BLOCKED" || entry.operation === "CONFLICT").length;
      if (secondRunBlocked) {
        const conflicts = secondPlan.entries.filter((entry) => entry.operation === "BLOCKED" || entry.operation === "CONFLICT");
        const byEntity = Object.fromEntries([...conflicts.reduce((counts, entry) => counts.set(entry.entity, (counts.get(entry.entity) ?? 0) + 1), new Map())]);
        const first = conflicts[0];
        const fields = first.desired && first.existing ? Object.keys(first.desired).filter((key) => !equalJson(first.desired[key], first.existing[key])) : [];
        throw new Error(`Release B second-run SQL state drift ${JSON.stringify(byEntity)} first=${first.entity}:${first.key} fields=${fields.join(",")}`);
      }
      const secondReceipt = await runLocalSchemaV1Import({
        target,
        plan: secondPlan,
        createClient: async () => createDisposablePostgresTransactionClient({ executeSql }),
      });
      const productCompatibility = await validateProductReader(state, expected);
      const receipt = {
        format: "openglass-device-schema-v1-release-b-sql-rehearsal-v1",
        status: "PASS",
        target: "LOCAL_DISPOSABLE_SQL",
        disposableSupabase: true,
        fullCanonicalMigrationChain: canonicalMigrationCount === 50,
        releaseASchemaPresent: verification.definitions === 92 && verification.triggerFailures === 0,
        manuallyRecreatedSchemaObjects: 0,
        yamlDeviceCount: expected.devices,
        identityMapCount: identityMap.mappings?.length ?? 0,
        unresolvedIdentities,
        unresolvedEvidenceMaps,
        dryRunBlocked,
        dryRunDelete: validPlan.delete,
        planFingerprint: fingerprintRecoveryPlan(validPlan),
        transactionResult: "COMMIT",
        counts: verification,
        sqlConstraintFailures: verification.constraintFailures,
        sqlTriggerFailures: verification.triggerFailures,
        deleteOperations: 0,
        conflictEvidenceFailures: verification.conflictEvidenceFailures,
        duplicateFailures: verification.duplicateFailures,
        unknownUnverifiedKnownData: verification.unknownUnverifiedKnownData,
        legacyYamlDerived,
        invalidPayloadResult: "FAIL",
        invalidPayloadSqlState: invalidError.sqlState,
        rowsCommittedAfterFailure: committedAfterFailure,
        transactionRollbackAtomicity: committedAfterFailure === 0 ? "PASS" : "BLOCKED",
        secondRunBlocked,
        secondRunDelete: secondPlan.delete,
        secondRunOperations: secondReceipt.operations,
        productCompatibilityLocal: productCompatibility ? "PASS" : "BLOCKED",
      };
      assertReleaseBSqlRehearsalReceipt(receipt);
      return receipt;
    },
  });
  return replay.afterMigrationLedgerValidated;
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Release B SQL rehearsal accepts no target or remote connection arguments");
  console.log(JSON.stringify(await runReleaseBSqlRehearsal()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`DEVICE_SCHEMA_V1_RELEASE_B_SQL_REHEARSAL_FAIL ${error.message}`); process.exitCode = 1; });
}
