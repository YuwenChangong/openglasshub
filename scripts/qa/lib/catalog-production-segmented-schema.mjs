import { deriveSchemaComponents } from "./catalog-production-schema-diagnostics.mjs";
import { schemaDigest } from "./catalog-production-migration-transport.mjs";
import { fail, sha256, canonical } from "./catalog-production-import.mjs";

export const SEGMENTED_CONTRACT = Object.freeze({
  format: "catalog-stage-c-segmented-execution-v1", componentsPerState: 11, schemaPassesPerImport: 4,
  reconciliationSelectsMax: 13, reconciliationDispatchesMax: 16,
  importSelectsMax: 49, importDispatchesMax: 61, importNonBodyStatementsMax: 60,
  connectDeadlineMs: 10000, queryDeadlineMs: 35000, importDeadlineMs: 125000,
  rollbackDeadlineMs: 5000, statementTimeoutMs: 120000, lockTimeoutMs: 5000,
  reconciliationWallClockMaxMs: 600000, importWallClockMaxMs: 2400000,
  connectionsMax: 1, writeTransactionsMax: 1, automaticRetry: false,
});
const components = deriveSchemaComponents();
const jsonbOrder = (left, right) => Buffer.byteLength(left) - Buffer.byteLength(right) || Buffer.compare(Buffer.from(left), Buffer.from(right));
const ordered = object => Object.fromEntries(Object.keys(object).sort(jsonbOrder).map(key => [key, object[key]]));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function segmentedExecutionContract(prepared) {
  // SET CONSTRAINTS, initialization DO, and its separate NULL-only UPDATE.
  const importInitializationStatements = 3, importSqlStatementsMax = 1766;
  return { ...SEGMENTED_CONTRACT, importInitializationStatements,
    importBodyStatementsMax: Math.min(importInitializationStatements + prepared.operations.length,
      importSqlStatementsMax - SEGMENTED_CONTRACT.importNonBodyStatementsMax), importSqlStatementsMax };
}
export function importBodyStatementWeight(plan, contract) {
  const inserts = Object.values(plan.inserts);
  const weight = contract.importInitializationStatements + inserts.reduce((sum, count) => sum + count, 0);
  if (inserts.some(count => !Number.isSafeInteger(count) || count < 0) || !Number.isSafeInteger(weight)
    || weight > contract.importBodyStatementsMax
    || weight + contract.importNonBodyStatementsMax > contract.importSqlStatementsMax) fail("IMPORT_STATEMENT_BUDGET_EXHAUSTED");
  return weight;
}
export function assertSegmentedExecutionContract(packet, prepared) {
  if (packet.format !== "catalog-stage-c-preparation-v2" || canonical(packet.executionContract) !== canonical(segmentedExecutionContract(prepared))) fail("IMPORT_AUTHORIZATION_BINDING_INVALID");
}

export function reconstructSchemaState(entries) {
  if (!Array.isArray(entries) || entries.length !== components.length) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
  const values = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || values.has(entry[0]) || !components.some(c => c.id === entry[0])) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
    values.set(entry[0], entry[1]);
  }
  const state = { schema: {} };
  for (const component of components) {
    const value = values.get(component.id);
    if (component.path[0] === "schema" && value !== null && !Array.isArray(value)) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
    if (component.id === "LEDGER_SHAPE" && !isObject(value) || component.id === "LEDGER_RECORDS" && !Array.isArray(value)) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
    if (component.id === "CATALOG_COUNTS" && (!isObject(value) || Object.keys(value).sort().join("|") !== "audit|definitions|devices|published|specs"
      || Object.values(value).some(n => !Number.isSafeInteger(n) || n < 0))) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
    if (component.path.length === 2) state.schema[component.path[1]] = value;
    else state[component.path[0]] = value;
  }
  // Only synthesized containers need ordering. Nested payloads retain pg's exact
  // JSONB representation, including nulls; never canonicalize the frozen digest.
  state.schema = ordered(state.schema);
  return ordered(state);
}

export function assertSegmentedStage2(state, packet) {
  let digest;
  try { digest = schemaDigest(state); } catch { fail("IMPORT_STAGE2_OR_READER_GRANTS_DRIFT"); }
  if (digest !== packet.stage2SchemaSha256 || !Array.isArray(packet.migrationHashes) || packet.migrationHashes.length !== 2
    || state.ledger?.length !== 2 || state.ledger.some((row, i) => !row || row.version !== ["20261004003349", "20261004014637"][i]
      || row.name !== ["public_device_detail_v1", "catalog_editor_presentation_v1"][i] || !Array.isArray(row.statements)
      || row.statements.length !== 1 || typeof row.statements[0] !== "string" || sha256(row.statements[0]) !== packet.migrationHashes[i])) fail("IMPORT_STAGE2_OR_READER_GRANTS_DRIFT");
}

// Caller owns the single transaction, identity, limits and cleanup. No open,
// BEGIN, fallback full query or retry is available in this verifier.
export async function readSegmentedStage2({ query, packet, onComponent = () => {} }) {
  const entries = [];
  for (const component of components) {
    onComponent(component.id);
    try {
      const response = await query(component.sql, component.id);
      if (response.rows?.length !== 1 || !Object.hasOwn(response.rows[0] ?? {}, "component")) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
      entries.push([component.id, response.rows[0].component]);
    } catch (error) {
      if (error && typeof error === "object" && Object.isExtensible(error)) Object.defineProperty(error, "schemaComponentId", { value: component.id, configurable: true });
      throw error;
    }
  }
  const state = reconstructSchemaState(entries);
  assertSegmentedStage2(state, packet);
  return state;
}
