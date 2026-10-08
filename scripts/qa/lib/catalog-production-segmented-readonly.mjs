import { IDENTITY_SQL } from "./catalog-production-migration-transport.mjs";
import { deriveSchemaComponents } from "./catalog-production-schema-diagnostics.mjs";
import { SEGMENTED_CONTRACT, reconstructSchemaState, assertSegmentedStage2 } from "./catalog-production-segmented-schema.mjs";
import { SNAPSHOT_SQL, sha256, fail, safeImportFailure } from "./catalog-production-import.mjs";

const components = deriveSchemaComponents();
const sequence = Object.freeze(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", IDENTITY_SQL, ...components.map(c => c.sql), SNAPSHOT_SQL, "COMMIT;"]);
const names = ["BEGIN", "IDENTITY", ...components.map(() => "SCHEMA"), "SNAPSHOT", "COMMIT"];
export const V4_APPROVAL = "AUTHORIZE_STAGE_C_SEGMENTED_READ_ONLY_RECONCILIATION_V4";
export function renderSegmentedReadOnlySql() {
  return sequence.map((sql, i) => `${i >= 2 && i <= 12 ? `-- ${components[i - 2].id}\n` : ""}${sql}`).join("\n\n") + "\n";
}

// Exact ordered SQL, not a SELECT-prefix filter. COMMIT/ROLLBACK only terminate
// this read-only transaction. No write authorization or connection factory.
export function createSegmentedReadOnlySession({ session, packet, expectedIdentity, deadline, now = () => performance.now() }) {
  let index = 0, failed = false, busy = false, transaction = false, rollbackUsed = false, closed = false;
  const entries = [];
  const evidence = { statements: 0, selects: 0, identity: false, schemaVerified: false, snapshotCompleted: false, operation: "CONNECT", components: [] };
  const reject = () => fail("IMPORT_READ_ONLY_EXECUTION_CONTRACT");
  return { evidence, get connected() { return !closed && session.connected; },
    async query(sql, values = [], requestedTimeout = SEGMENTED_CONTRACT.queryDeadlineMs) {
      if (closed || busy || !session.connected || !Array.isArray(values) || values.length || !Number.isFinite(requestedTimeout) || requestedTimeout <= 0) reject();
      const rollback = sql === "ROLLBACK;";
      if (rollback ? !transaction || rollbackUsed : failed || sql !== sequence[index]) reject();
      const remaining = deadline - now(); if (!Number.isFinite(remaining) || remaining <= 0) reject();
      const select = !rollback && index >= 1 && index <= 13;
      if (evidence.statements >= SEGMENTED_CONTRACT.reconciliationDispatchesMax || select && evidence.selects >= SEGMENTED_CONTRACT.reconciliationSelectsMax) reject();
      evidence.statements++; if (select) evidence.selects++;
      if (rollback) rollbackUsed = true;
      const operation = rollback ? "ROLLBACK" : names[index];
      const component = !rollback && index >= 2 && index <= 12 ? components[index - 2] : null;
      if (!rollback) evidence.operation = operation;
      const started = now(); busy = true;
      try {
        const response = await session.query(sql, [], Math.min(rollback ? SEGMENTED_CONTRACT.rollbackDeadlineMs : SEGMENTED_CONTRACT.queryDeadlineMs, requestedTimeout, remaining));
        if (operation === "IDENTITY") {
          const row = response.rows?.[0];
          if (response.rows?.length !== 1 || sha256(JSON.stringify({ database: row.database, role: row.role, port: row.port, system_identifier: row.system_identifier })) !== expectedIdentity) fail("IMPORT_SERVER_IDENTITY_MISMATCH");
          evidence.identity = true;
        }
        if (component) {
          if (response.rows?.length !== 1 || !Object.hasOwn(response.rows[0] ?? {}, "component")) fail("IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID");
          entries.push([component.id, response.rows[0].component]);
          if (index === 12) { assertSegmentedStage2(reconstructSchemaState(entries), packet); evidence.schemaVerified = true; }
          evidence.components.push({ componentId: component.id, status: "PASS", durationMs: Math.floor(now() - started) });
        }
        if (operation === "BEGIN") transaction = true;
        if (operation === "SNAPSHOT") {
          if (!evidence.schemaVerified || response.rows?.length !== 1) reject();
          evidence.snapshotCompleted = true;
        }
        if (rollback || operation === "COMMIT") transaction = false;
        if (!rollback) index++;
        return response;
      } catch (error) {
        failed = true;
        if (component && error && typeof error === "object" && Object.isExtensible(error)) Object.defineProperty(error, "schemaComponentId", { value: component.id, configurable: true });
        if (!rollback) evidence.firstDiagnostic ??= safeImportFailure(error, operation, now() - started, session.connected);
        throw error;
      } finally { busy = false; }
    },
    async close() { closed = true; return session.close(); },
  };
}
