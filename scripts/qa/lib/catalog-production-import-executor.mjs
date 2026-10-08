import { execFileSync } from "node:child_process";
import { readFile, open as openFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { IDENTITY_SQL, STATE_SQL, schemaDigest } from "./catalog-production-migration-transport.mjs";
import { prepareImport, reconcileImport, verifyImport, canonical, sha256, fail, TABLES, SNAPSHOT_SQL, safeImportFailure } from "./catalog-production-import.mjs";

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
  return { format: "catalog-stage-c-preparation-v1", executionAuthorized: false, candidateHead: checkout.head,
    checkoutSha256: sha256(await realpath(root)), sourceSha256: prepared.sourceSha256, sqlSha256: sha256(prepared.sql), fileHashes,
    stage2SchemaSha256: proof.states[2], migrationHashes: proof.migrationHashes,
    targetRequirements: { endpointClass: "SUPAVISOR_SESSION", project: "xcbnxzjlsvtgzixurcof", database: "postgres", role: "postgres", port: 5432,
      serverIdentityAuthority: "EXACT_HUMAN_APPROVED_RECEIPT_RECONFIRMED_BEFORE_WRITE" },
    targets: { devices: 24, specs: 1488, knownValues: prepared.knownValues, reviewedConflictSpecs: 7 },
    maximumInserts: Object.fromEntries(Object.keys(TABLES).map(entity => [entity, prepared.operations.filter(op => op.entity === entity).length])),
    maximumNullSchemaTypeUpdates: 24, connectionsMax: 1, readStatementsMax: 9, writeTransactionsMax: 1,
    automaticRetry: false, activationAllowed: false, productionConflictCount: "UNKNOWN" };
}

export function validateAuthorization(receipt, packet, now = Date.now()) {
  const keys = ["format", "authorizationId", "packetSha256", "candidateHead", "checkoutSha256", "serverIdentitySha256", "targetClass", "reconciliationSha256", "windowStartUTC", "windowEndUTC", "humanGates"];
  if (!receipt || canonical(Object.keys(receipt).sort()) !== canonical(keys.sort())) fail("IMPORT_AUTHORIZATION_SHAPE_INVALID");
  if (receipt.format !== "catalog-stage-c-authorization-v1" || !/^stage-c-[a-z0-9-]{3,80}$/.test(receipt.authorizationId) || receipt.targetClass !== "SUPAVISOR_SESSION"
    || receipt.packetSha256 !== sha256(canonical(packet)) || receipt.candidateHead !== packet.candidateHead || receipt.checkoutSha256 !== packet.checkoutSha256
    || !HEX64.test(receipt.serverIdentitySha256) || !HEX64.test(receipt.reconciliationSha256)) fail("IMPORT_AUTHORIZATION_BINDING_INVALID");
  for (const timestamp of [receipt.windowStartUTC, receipt.windowEndUTC]) if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail("IMPORT_WINDOW_INVALID");
  if (!(Date.parse(receipt.windowStartUTC) <= now && now < Date.parse(receipt.windowEndUTC))) fail("IMPORT_WINDOW_NOT_ACTIVE");
  const gates = ["backupRecoveryReady", "catalogWritesPaused", "currentReaderCompatible", "stageBCompleted", "productionReconciliationReviewed", "rollbackOperatorReady"];
  if (!receipt.humanGates || canonical(Object.keys(receipt.humanGates).sort()) !== canonical(gates.sort()) || gates.some(g => receipt.humanGates[g] !== true)) fail("IMPORT_HUMAN_GATE_REQUIRED");
}

export async function loadImportBundle({ root, packet, receipt, now = Date.now() }) {
  if (canonical(packet) !== canonical(await createImportPacket(root))) fail("IMPORT_PACKET_DRIFT");
  validateAuthorization(receipt, packet, now);
  const bundle = { packet: structuredClone(packet), receipt: structuredClone(receipt), prepared: await prepareImport(root) };
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

function assertStage2(state, packet) {
  if (schemaDigest(state) !== packet.stage2SchemaSha256 || state.ledger?.length !== 2 || state.ledger.some((row, i) => row.version !== ["20261004003349", "20261004014637"][i]
    || row.name !== ["public_device_detail_v1", "catalog_editor_presentation_v1"][i] || row.statements?.length !== 1 || sha256(row.statements[0]) !== packet.migrationHashes[i])) fail("IMPORT_STAGE2_OR_READER_GRANTS_DRIFT");
}
const LOCK_SQL = `LOCK TABLE supabase_migrations.schema_migrations, ${Object.values(TABLES).map(t => "public." + t).join(", ")}, public.catalog_audit_events IN SHARE ROW EXCLUSIVE MODE;`;

export async function executeImport({ bundle, open, claim, now = Date.now }) {
  if (!validated.has(bundle)) fail("IMPORT_VALIDATED_BUNDLE_REQUIRED");
  let session, transaction = false, commitDispatched = false, committed = false, readStatements = 0, operation = "APPROVAL", started = performance.now(), before, plan, schema;
  const result = { format: "catalog-stage-c-result-v1", candidateHead: bundle.packet.candidateHead, status: "BLOCKED", authorizationConsumed: false,
    connections: 0, writeTransactions: 0, importAttempts: 0, automaticRetries: 0, activationAttempts: 0, commitDispatched: false, committed: false };
  const mark = name => { operation = name; started = performance.now(); };
  const query = async (sql, op, read = false) => {
    mark(op);
    const remaining = Date.parse(bundle.receipt.windowEndUTC) - now();
    if (remaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    if (read && ++readStatements > 9) fail("IMPORT_READ_BUDGET_EXHAUSTED");
    return session.query(sql, [], Math.min(op === "IMPORT" ? 125000 : 35000, remaining));
  };
  const state = async () => { const response = await query(STATE_SQL, "SCHEMA", true); const value = response.rows?.[0]?.state; if (response.rows?.length !== 1) fail("IMPORT_SCHEMA_RESPONSE_INVALID"); assertStage2(value, bundle.packet); return value; };
  const snapshot = async (op = "SNAPSHOT") => { const response = await query(SNAPSHOT_SQL, op, true); if (response.rows?.length !== 1) fail("IMPORT_SNAPSHOT_RESPONSE_INVALID"); return response.rows[0].snapshot; };
  try {
    validateAuthorization(bundle.receipt, bundle.packet, now());
    mark("CLAIM"); await claim(bundle.receipt.authorizationId, sha256(canonical(bundle.receipt))); result.authorizationConsumed = true;
    const connectRemaining = Date.parse(bundle.receipt.windowEndUTC) - now();
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
    await query("SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='60s';", "LOCK");
    await query(LOCK_SQL, "LOCK"); await state();
    const locked = await snapshot();
    if (canonical(locked) !== canonical(before)) fail("IMPORT_PREWRITE_CONCURRENT_CHANGE");
    result.importAttempts++; await query(bundle.prepared.body, "IMPORT");
    const after = await snapshot(); mark("VERIFY"); verifyImport(bundle.prepared, before, after, plan);
    const postSchema = await state();
    const auditDelta = postSchema.counts.audit - schema.counts.audit;
    if (!Number.isSafeInteger(auditDelta) || auditDelta < 0 || auditDelta > Object.values(plan.inserts).reduce((a, b) => a + b, 0) + plan.nullSchemaType) fail("IMPORT_AUDIT_WRITE_SCOPE_EXCEEDED");
    // The timeout/window gate must pass BEFORE marking COMMIT dispatched.
    const commitRemaining = Date.parse(bundle.receipt.windowEndUTC) - now();
    if (commitRemaining <= 0) fail("IMPORT_WINDOW_EXPIRED");
    mark("COMMIT"); commitDispatched = true; result.commitDispatched = true;
    await session.query("COMMIT;", [], Math.min(35000, commitRemaining)); transaction = false; committed = true; result.committed = true;
    await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", "BEGIN"); transaction = true;
    await state(); const postCommit = await snapshot("POSTCOMMIT"); mark("VERIFY"); verifyImport(bundle.prepared, before, postCommit, plan);
    await query("COMMIT;", "COMMIT"); transaction = false;
    result.status = "PASS"; result.postCommitVerification = "PASS";
    result.reconciliationSha256 = plan.reconciliationSha256;
    result.inserts = plan.inserts; result.nullSchemaTypeUpdates = plan.nullSchemaType;
  } catch (error) {
    result.status = commitDispatched && !committed ? "AMBIGUOUS" : committed ? "COMMITTED_VERIFICATION_FAILED" : "BLOCKED";
    result.diagnostic = safeImportFailure(error, operation, performance.now() - started, session?.connected);
    if (transaction && (!commitDispatched || committed)) {
      try { await session.query("ROLLBACK;", [], 5000); result.rollback = "PASS"; } catch { result.rollback = "FAILED_CLOSE_REQUIRED"; }
    }
  } finally {
    result.readStatements = readStatements;
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
  try {
    await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"); transaction = true;
    const response = await session.query(IDENTITY_SQL); const row = response.rows?.[0];
    if (response.rows?.length !== 1 || sha256(JSON.stringify({ database: row.database, role: row.role, port: row.port, system_identifier: row.system_identifier })) !== expectedServerIdentitySha256) fail("IMPORT_SERVER_IDENTITY_MISMATCH");
    assertStage2((await session.query(STATE_SQL)).rows?.[0]?.state, packet);
    const report = reconcileImport(prepared, (await session.query(SNAPSHOT_SQL)).rows?.[0]?.snapshot);
    await session.query("COMMIT;"); transaction = false;
    return report;
  } finally { if (transaction) await session.query("ROLLBACK;"); }
}
