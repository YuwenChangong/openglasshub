import { execFileSync } from "node:child_process";
import { readFile, open as openFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { IDENTITY_SQL } from "./catalog-production-migration-transport.mjs";
import { readSegmentedStage2, SEGMENTED_CONTRACT, segmentedExecutionContract, assertSegmentedExecutionContract, importBodyStatementWeight } from "./catalog-production-segmented-schema.mjs";
import { prepareImport, reconcileImport, verifyImport, verifyAudit, canonical, sha256, fail, TABLES, SNAPSHOT_SQL, safeImportFailure, buildImportBody } from "./catalog-production-import.mjs";

const validated = new WeakSet();
const TOOL_PATHS = [
  "scripts/qa/catalog-production-import-runner.mjs", "scripts/qa/lib/catalog-production-import.mjs",
  "scripts/qa/lib/catalog-production-import-executor.mjs", "scripts/qa/lib/catalog-production-import-postgres.mjs",
  "scripts/lib/catalog-canonical-import.mjs", "scripts/lib/product-detail-repository-inventory.mjs",
  "scripts/devices/schema-v1/disposable-postgres-transaction-client.mjs",
  "scripts/qa/lib/catalog-production-migration-transport.mjs", "scripts/qa/lib/catalog-production-migration-postgres-adapter.mjs",
  "scripts/qa/p9-readonly-postgres-transport.mjs", "scripts/qa/fixtures/catalog-stage-b-schema-proof.json", "package-lock.json",
  "artifacts/qa/product-publication-cohort-v1/publication-contract.json", "artifacts/qa/catalog-migration-packet-v1/manifest.json",
  "artifacts/qa/catalog-migration-packet-v1/canonical-import.sql",
  "scripts/qa/test-catalog-production-import.mjs", "scripts/qa/test-catalog-production-import-local.mjs",
  "scripts/qa/test-catalog-production-import-audit.mjs", "supabase/migrations/20260909195640_device_schema_v1_foundation.sql",
  "scripts/qa/test-catalog-production-import-timeouts.mjs",
  "scripts/qa/lib/catalog-production-schema-diagnostics.mjs", "scripts/qa/test-catalog-production-schema-diagnostics.mjs",
  "scripts/qa/lib/catalog-production-segmented-schema.mjs", "scripts/qa/test-catalog-production-segmented-schema.mjs",
  "scripts/qa/lib/catalog-production-segmented-readonly.mjs", "scripts/qa/test-catalog-production-segmented-readonly.mjs",
  "scripts/qa/test-catalog-production-import-accounting.mjs",
  "docs/superpowers/plans/2026-10-08-stage-c-segmented-schema-proof.md",
  "docs/ops/catalog-stage-c-schema-component-diagnostics.md",
  "docs/ops/catalog-stage-c-import-execution.md", "docs/superpowers/plans/2026-10-04-catalog-production-migration-packet.md",
  "supabase/migrations/20261004003349_public_device_detail_v1.sql", "supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql",
];
const HEX64 = /^[a-f0-9]{64}$/;
export function inspectCheckout(root) {
  const git = args => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();
  return { head: git(["rev-parse", "HEAD"]), clean: git(["status", "--porcelain", "--untracked-files=all"]) === "" };
}
export async function createImportPacket(root) {
  if (await realpath(root) !== await realpath(path.resolve(import.meta.dirname, "../../.."))) fail("IMPORT_EXECUTION_CHECKOUT_MISMATCH");
  const checkout = inspectCheckout(root);
  if (!checkout.clean) fail("IMPORT_CHECKOUT_DIRTY");
  const prepared = await prepareImport(root);
  const paths = [...new Set([...TOOL_PATHS, ...prepared.inputPaths])].sort();
  const fileHashes = Object.fromEntries(await Promise.all(paths.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
  const proof = JSON.parse(await readFile(path.join(root, "scripts/qa/fixtures/catalog-stage-b-schema-proof.json"), "utf8"));
  return { format: "catalog-stage-c-preparation-v2", executionAuthorized: false, candidateHead: checkout.head,
    checkoutSha256: sha256(await realpath(root)), sourceSha256: prepared.sourceSha256, sqlSha256: sha256(prepared.sql), fileHashes,
    stage2SchemaSha256: proof.states[2], migrationHashes: proof.migrationHashes,
    targetRequirements: { endpointClass: "SUPAVISOR_SESSION", project: "xcbnxzjlsvtgzixurcof", database: "postgres", role: "postgres", port: 5432,
      serverIdentityAuthority: "EXACT_HUMAN_APPROVED_RECEIPT_RECONFIRMED_BEFORE_WRITE" },
    targets: { devices: 24, specs: 1488, knownValues: prepared.knownValues, reviewedConflictSpecs: 7 },
    maximumInserts: Object.fromEntries(Object.keys(TABLES).map(entity => [entity, prepared.operations.filter(op => op.entity === entity).length])),
    maximumNullSchemaTypeUpdates: 24, connectionsMax: 1, readStatementsMax: SEGMENTED_CONTRACT.importSelectsMax, writeTransactionsMax: 1,
    executionContract: segmentedExecutionContract(prepared),
    auditContract: "catalog-stage-c-audit-content-v1", maximumAuditEvents: 50000,
    automaticRetry: false, activationAllowed: false, productionConflictCount: "UNKNOWN" };
}

export function validateAuthorization(receipt, packet, now = Date.now()) {
  const keys = ["format", "authorizationId", "packetSha256", "candidateHead", "checkoutSha256", "serverIdentitySha256", "targetClass", "reconciliationSha256", "windowStartUTC", "windowEndUTC", "humanGates", "executionContractSha256"];
  if (!receipt || canonical(Object.keys(receipt).sort()) !== canonical(keys.sort())) fail("IMPORT_AUTHORIZATION_SHAPE_INVALID");
  if (receipt.format !== "catalog-stage-c-authorization-v2" || packet.format !== "catalog-stage-c-preparation-v2" || !packet.executionContract
    || receipt.executionContractSha256 !== sha256(canonical(packet.executionContract))
    || !/^stage-c-[a-z0-9-]{3,80}$/.test(receipt.authorizationId) || receipt.targetClass !== "SUPAVISOR_SESSION"
    || receipt.packetSha256 !== sha256(canonical(packet)) || receipt.candidateHead !== packet.candidateHead || receipt.checkoutSha256 !== packet.checkoutSha256
    || !HEX64.test(receipt.serverIdentitySha256) || !HEX64.test(receipt.reconciliationSha256)) fail("IMPORT_AUTHORIZATION_BINDING_INVALID");
  for (const timestamp of [receipt.windowStartUTC, receipt.windowEndUTC]) if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail("IMPORT_WINDOW_INVALID");
  if (!(Date.parse(receipt.windowStartUTC) <= now && now < Date.parse(receipt.windowEndUTC))
    || Date.parse(receipt.windowEndUTC) - Date.parse(receipt.windowStartUTC) > SEGMENTED_CONTRACT.importWallClockMaxMs) fail("IMPORT_WINDOW_NOT_ACTIVE");
  const gates = ["backupRecoveryReady", "catalogWritesPaused", "currentReaderCompatible", "stageBCompleted", "productionReconciliationReviewed", "rollbackOperatorReady"];
  if (!receipt.humanGates || canonical(Object.keys(receipt.humanGates).sort()) !== canonical(gates.sort()) || gates.some(g => receipt.humanGates[g] !== true)) fail("IMPORT_HUMAN_GATE_REQUIRED");
}

export async function loadImportBundle({ root, packet, receipt, now = Date.now() }) {
  if (canonical(packet) !== canonical(await createImportPacket(root))) fail("IMPORT_PACKET_DRIFT");
  validateAuthorization(receipt, packet, now);
  const bundle = { packet: structuredClone(packet), receipt: structuredClone(receipt), prepared: await prepareImport(root) };
  assertSegmentedExecutionContract(packet, bundle.prepared);
  // No caller can change approved operations or approval facts after validation.
  const freeze = v => { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; };
  freeze(bundle); validated.add(bundle); return bundle;
}

export async function claimImportAuthorization(root, id, receiptSha256) {
  if (!/^stage-c-[a-z0-9-]{3,80}$/.test(id) || !HEX64.test(receiptSha256)) fail("IMPORT_CLAIM_INVALID");
  const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
  const directory = path.join(path.resolve(root, common), "catalog-stage-c-authorizations");
  await mkdir(directory, { recursive: true });
  let handle;
  try { handle = await openFile(path.join(directory, `${id}.json`), "wx", 0o600); }
  catch { fail("IMPORT_AUTHORIZATION_ALREADY_CLAIMED_OR_UNAVAILABLE"); }
  try { await handle.writeFile(canonical({ authorizationId: id, receiptSha256, consumed: true }) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
}

const LOCK_SQL = `LOCK TABLE supabase_migrations.schema_migrations, ${Object.values(TABLES).map(t => "public." + t).join(", ")}, public.catalog_audit_events IN SHARE ROW EXCLUSIVE MODE;`;

export async function executeImport({ bundle, open, claim, now = Date.now }) {
  if (!validated.has(bundle)) fail("IMPORT_VALIDATED_BUNDLE_REQUIRED");
  let session, transaction = false, commitDispatched = false, committed = false, readStatements = 0, operation = "APPROVAL", started = performance.now(), before, plan, schema;
  const result = { format: "catalog-stage-c-result-v1", candidateHead: bundle.packet.candidateHead, status: "BLOCKED", authorizationConsumed: false,
    connections: 0, writeTransactions: 0, importAttempts: 0, automaticRetries: 0, activationAttempts: 0, commitDispatched: false, committed: false };
  const mark = name => { operation = name; started = performance.now(); };
  let dispatches = 0, sqlStatements = 0;
  const wallDeadline = performance.now() + SEGMENTED_CONTRACT.importWallClockMaxMs;
  const remainingTime = () => Math.min(Date.parse(bundle.receipt.windowEndUTC) - now(), wallDeadline - performance.now());
  const query = async (sql, op, read = false, statementWeight = 1, writeCommit = false) => {
    mark(op);
    const remaining = remainingTime();
    if (remaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    if (++dispatches > SEGMENTED_CONTRACT.importDispatchesMax || (sqlStatements += statementWeight) > bundle.packet.executionContract.importSqlStatementsMax) fail("IMPORT_STATEMENT_BUDGET_EXHAUSTED");
    if (read && ++readStatements > SEGMENTED_CONTRACT.importSelectsMax) fail("IMPORT_READ_BUDGET_EXHAUSTED");
    if (writeCommit) { commitDispatched = true; result.commitDispatched = true; }
    return session.query(sql, [], Math.min(op === "IMPORT" ? 125000 : 35000, remaining));
  };
  const state = () => readSegmentedStage2({ packet: bundle.packet, query: sql => query(sql, "SCHEMA", true), onComponent: id => { result.schemaComponentId = id; } });
  const snapshot = async (op = "SNAPSHOT") => { const response = await query(SNAPSHOT_SQL, op, true); if (response.rows?.length !== 1) fail("IMPORT_SNAPSHOT_RESPONSE_INVALID"); return response.rows[0].snapshot; };
  try {
    validateAuthorization(bundle.receipt, bundle.packet, now());
    mark("CLAIM"); await claim(bundle.receipt.authorizationId, sha256(canonical(bundle.receipt))); result.authorizationConsumed = true;
    const connectRemaining = remainingTime();
    if (connectRemaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    mark("CONNECT"); result.connections++; session = await open(Math.min(10000, connectRemaining));
    await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", "BEGIN"); transaction = true;
    const identityResult = await query(IDENTITY_SQL, "IDENTITY", true);
    const row = identityResult.rows?.[0];
    if (identityResult.rows?.length !== 1 || sha256(JSON.stringify({ database: row.database, role: row.role, port: row.port, system_identifier: row.system_identifier })) !== bundle.receipt.serverIdentitySha256) fail("IMPORT_SERVER_IDENTITY_MISMATCH");
    schema = await state(); before = await snapshot(); plan = reconcileImport(bundle.prepared, before);
    if (plan.blockers.length) fail("IMPORT_PREWRITE_CONFLICT");
    if (plan.reconciliationSha256 !== bundle.receipt.reconciliationSha256) fail("IMPORT_RECONCILIATION_NOT_APPROVED");
    await query("COMMIT;", "COMMIT"); transaction = false;
    await query("BEGIN;", "BEGIN"); transaction = true; result.writeTransactions++;
    for (const sql of ["SET LOCAL statement_timeout='120s';", "SET LOCAL lock_timeout='5s';", "SET LOCAL idle_in_transaction_session_timeout='60s';"]) await query(sql, "LOCK");
    await query(LOCK_SQL, "LOCK"); await state();
    const locked = await snapshot();
    if (canonical(locked) !== canonical(before)) fail("IMPORT_PREWRITE_CONCURRENT_CHANGE");
    mark("IMPORT");
    const bodyStatements = importBodyStatementWeight(plan, bundle.packet.executionContract);
    result.importAttempts++; await query(buildImportBody(bundle.prepared, plan), "IMPORT", false, bodyStatements);
    const after = await snapshot(); mark("VERIFY"); verifyImport(bundle.prepared, before, after, plan);
    const postSchema = await state();
    const auditDelta = postSchema.counts.audit - schema.counts.audit;
    if (!Number.isSafeInteger(auditDelta) || auditDelta < 0 || auditDelta > Object.values(plan.inserts).reduce((a, b) => a + b, 0) + plan.nullSchemaType) fail("IMPORT_AUDIT_WRITE_SCOPE_EXCEEDED");
    // The timeout/window gate must pass BEFORE marking COMMIT dispatched.
    const commitRemaining = remainingTime();
    if (commitRemaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    await query("COMMIT;", "COMMIT", false, 1, true); transaction = false; committed = true; result.committed = true;
    await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", "BEGIN"); transaction = true;
    await state(); const postCommit = await snapshot("POSTCOMMIT"); mark("VERIFY"); verifyImport(bundle.prepared, before, postCommit, plan);
    verifyAudit(after, postCommit, { actions: [] });
    await query("COMMIT;", "COMMIT"); transaction = false;
    result.status = "PASS"; result.postCommitVerification = "PASS";
    result.reconciliationSha256 = plan.reconciliationSha256;
    result.writeSetSha256 = plan.writeSetSha256;
    result.inserts = plan.inserts; result.nullSchemaTypeUpdates = plan.nullSchemaType;
  } catch (error) {
    result.status = commitDispatched && !committed ? "AMBIGUOUS" : committed ? "COMMITTED_VERIFICATION_FAILED" : "BLOCKED";
    result.diagnostic = safeImportFailure(error, operation, performance.now() - started, session?.connected);
    if (transaction && (!commitDispatched || committed)) {
      try {
        if (++dispatches > SEGMENTED_CONTRACT.importDispatchesMax || ++sqlStatements > bundle.packet.executionContract.importSqlStatementsMax) fail("IMPORT_STATEMENT_BUDGET_EXHAUSTED");
        await session.query("ROLLBACK;", [], 5000); result.rollback = "PASS";
      } catch { result.rollback = "FAILED_CLOSE_REQUIRED"; }
    }
  } finally {
    result.readStatements = readStatements;
    result.dispatches = dispatches; result.sqlStatements = sqlStatements;
    if (session) try { await session.close(); result.connectionClose = "PASS"; } catch (error) {
      result.connectionClose = "FAILED"; result.closeDiagnostic = safeImportFailure(error, "CLOSE", 0, false);
      if (result.status === "PASS") result.status = "COMMITTED_CLOSE_FAILED";
    }
  }
  return result;
}

// A subsequent separately authorized read-only comparison can call this function
// with ONE already-open session. It does not claim write authorization or write.
export async function readImportReconciliation({ packet, prepared, session, expectedServerIdentitySha256 }) {
  let transaction = false;
  assertSegmentedExecutionContract(packet, prepared);
  const deadline = performance.now() + SEGMENTED_CONTRACT.reconciliationWallClockMaxMs;
  let dispatches = 0, selects = 0;
  const query = (sql, read = false) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    if (++dispatches > SEGMENTED_CONTRACT.reconciliationDispatchesMax || read && ++selects > SEGMENTED_CONTRACT.reconciliationSelectsMax) fail("IMPORT_READ_BUDGET_EXHAUSTED");
    return session.query(sql, [], Math.min(35000, remaining));
  };
  try {
    await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"); transaction = true;
    const response = await query(IDENTITY_SQL, true); const row = response.rows?.[0];
    if (response.rows?.length !== 1 || sha256(JSON.stringify({ database: row.database, role: row.role, port: row.port, system_identifier: row.system_identifier })) !== expectedServerIdentitySha256) fail("IMPORT_SERVER_IDENTITY_MISMATCH");
    await readSegmentedStage2({ packet, query: sql => query(sql, true) });
    const snapshot = await query(SNAPSHOT_SQL, true);
    if (snapshot.rows?.length !== 1) fail("IMPORT_SNAPSHOT_RESPONSE_INVALID");
    const report = reconcileImport(prepared, snapshot.rows[0].snapshot);
    await query("COMMIT;"); transaction = false;
    return report;
  } catch (error) {
    if (transaction) try { await session.query("ROLLBACK;", [], 5000); } catch { /* Caller must close the same session. */ }
    throw error;
  }
}
