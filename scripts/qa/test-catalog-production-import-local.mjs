import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { withCanonicalBaselineDirectory, runLocalDisposableReplay, assertLocalReplayTarget } from "./local-disposable-supabase-replay.mjs";
import { IDENTITY_SQL, STATE_SQL } from "./lib/catalog-production-migration-transport.mjs";
import { prepareImport, reconcileImport, verifyImport, canonical, sha256, SNAPSHOT_SQL, buildImportBody, safeImportFailure } from "./lib/catalog-production-import.mjs";
import { createImportPacket, loadImportBundle, executeImport, claimImportAuthorization, readImportReconciliation } from "./lib/catalog-production-import-executor.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { runLocalTimeoutChecks } from "./test-catalog-production-import-timeouts.mjs";
import { runLocalSchemaDiagnosticChecks } from "./test-catalog-production-schema-diagnostics.mjs";
import { runLocalSegmentedSchemaChecks } from "./test-catalog-production-segmented-schema.mjs";
import { deriveSchemaComponents } from "./lib/catalog-production-schema-diagnostics.mjs";
import { prepareCanonicalCatalogImport } from "../lib/catalog-canonical-import.mjs";
import { renderReleaseBAuthorizedOperation } from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";

const root = path.resolve(import.meta.dirname, "../..");
if (process.argv.length !== 2) throw new Error("LOCAL_TEST_ARGUMENT_REJECTED");
const runId = randomUUID();
const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC", "SystemDrive", "ProgramData"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const receipt = { format: "catalog-stage-c-local-v1", runId, status: "BLOCKED", assertions: [], productionConnections: 0, activationAttempts: 0 };
const check = (value, label) => { assert.ok(value, label); receipt.assertions.push(label); };
const prepared = await prepareImport(root);
const packet = await createImportPacket(root);
receipt.candidateHead = packet.candidateHead; receipt.packetSha256 = sha256(canonical(packet)); receipt.sourceSha256 = prepared.sourceSha256;
const sqlBlob = file => execFileSync("git", ["-C", root, "show", "HEAD:" + file], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
try {
  await withCanonicalBaselineDirectory({ root, environment }, async canonicalBaselineDirectory => runLocalDisposableReplay({ root, environment, migrationLimit: 50, canonicalBaselineDirectory,
    enforcementRunner: async () => ({ status: "NOT_RUN", assertions: 0 }), afterMigrationLedgerValidated: async ({ target }) => {
      assertLocalReplayTarget(target); const url = new URL(target); assert.equal(url.hostname, "127.0.0.1");
      const config = { host: "127.0.0.1", port: Number(url.port) + 1, user: "postgres", password: "postgres", database: "postgres", ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 120000 };
      const admin = new pg.Client(config); await admin.connect();
      try {
        // Apply completed Stage B ONLY to this owned disposable local database.
        for (const [version, name] of [["20261004003349", "public_device_detail_v1"], ["20261004014637", "catalog_editor_presentation_v1"]]) {
          const sql = sqlBlob(`supabase/migrations/${version}_${name}.sql`);
          await admin.query("BEGIN;"); await admin.query(sql);
          await admin.query("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ($1,$2,$3);", [version, name, [sql]]); await admin.query("COMMIT;");
        }
        const identity = (await admin.query(IDENTITY_SQL)).rows[0];
        await runLocalTimeoutChecks({ config, admin, check });
        const identitySha256 = sha256(JSON.stringify({ database: identity.database, role: identity.role, port: identity.port, system_identifier: identity.system_identifier }));
        receipt.schemaComponentTimings = await runLocalSchemaDiagnosticChecks({ config, admin, check, packet, prepared, identitySha256 });
        await runLocalSegmentedSchemaChecks({ config, admin, check, packet, prepared });
        const adminId = randomUUID();
        await admin.query("INSERT INTO auth.users(id,email) VALUES ($1,$2);", [adminId, "stage-c-owned-local@example.invalid"]);
        await admin.query("UPDATE public.profiles SET role='admin' WHERE id=$1;", [adminId]);
        const snapshot = async () => (await admin.query(SNAPSHOT_SQL)).rows[0].snapshot;
        let initial = await snapshot();
        const fixedTime = Date.parse("2020-01-01T00:01:00Z");
        const read = await readImportReconciliation({ packet, prepared, session: {
          query: (text, values, deadline) => admin.query({ text, values, query_timeout: deadline }),
        }, expectedServerIdentitySha256: identitySha256 });
        check(read.inserts.device === 24 && read.inserts.spec === 1488 && read.blockers.length === 0, "GENUINE_STATE2_INITIAL_RECONCILIATION");
        const run = async ({ fault, identityDigest = identitySha256, reconciliationDigest, expire, commitRace, actor = null } = {}) => {
          const baseline = await snapshot();
          baseline.auditActor = actor;
          const plan = reconcileImport(prepared, baseline);
          const importBody = plan.blockers.length ? null : buildImportBody(prepared, plan);
          const authorizationId = "stage-c-local-" + randomUUID();
          const auth = { format: "catalog-stage-c-authorization-v2", executionContractSha256: sha256(canonical(packet.executionContract)), authorizationId, packetSha256: sha256(canonical(packet)), candidateHead: packet.candidateHead,
            checkoutSha256: packet.checkoutSha256, targetClass: "SUPAVISOR_SESSION", serverIdentitySha256: identityDigest, reconciliationSha256: reconciliationDigest ?? plan.reconciliationSha256,
            windowStartUTC: "2020-01-01T00:00:00Z", windowEndUTC: "2020-01-01T00:10:00Z", humanGates: { backupRecoveryReady: true, catalogWritesPaused: true, currentReaderCompatible: true,
              stageBCompleted: true, productionReconciliationReviewed: true, rollbackOperatorReady: true } };
          const bundle = await loadImportBundle({ root, packet, receipt: auth, now: fixedTime });
          let clock = fixedTime, commitClockChecks = 0, finalSchemaCompleted = false;
          const trace = { connects: 0, queries: [], snapshots: 0, imports: 0 };
          class OwnedClient {
            constructor() { this.client = new pg.Client(config); }
            on(...args) { return this.client.on(...args); }
            async connect() {
              trace.connects++; await this.client.connect();
              if (actor) await this.client.query("SELECT set_config('request.jwt.claims',$1,false);", [JSON.stringify({ sub: actor, role: "authenticated" })]);
            }
            async query(q) {
              trace.queries.push(q.text); if (q.text === SNAPSHOT_SQL) trace.snapshots++;
              if (q.text === importBody) trace.imports++;
              const result = await this.client.query(q);
              if (q.text === importBody) {
                trace.bodyStatements = result.length;
                trace.bodyCommands = result.map(item => item.command);
                trace.updatedRows = result.filter(item => item.command === "UPDATE").reduce((sum, item) => sum + item.rowCount, 0);
                check(result.length === 3 + Object.values(plan.inserts).reduce((sum, count) => sum + count, 0), "POSTGRES_ACTUAL_BODY_STATEMENTS_MATCH_ACCOUNTING");
              }
              if (q.text === deriveSchemaComponents().at(-1).sql && trace.imports > 0 && trace.snapshots === 3) finalSchemaCompleted = true;
              if (expire && q.text === deriveSchemaComponents()[0].sql && trace.imports > 0) clock = Date.parse(auth.windowEndUTC);
              await fault?.({ q: { ...q, isImport: q.text === importBody }, client: this.client, trace, result }); return result;
            }
            async end() { await this.client.end(); }
          }
          const open = createImportPostgresAdapter({ config, Client: OwnedClient });
          const claim = (id, digest) => claimImportAuthorization(root, id, digest);
          const result = await executeImport({ bundle, open, claim, now: () => {
            if (commitRace && finalSchemaCompleted && ++commitClockChecks === 2) clock = Date.parse(auth.windowEndUTC);
            return clock;
          } });
          receipt.lastOutcome = result;
          check(trace.connects === 1 && result.authorizationConsumed && result.automaticRetries === 0 && result.connectionClose === "PASS", "ONE_CONNECTION_DURABLE_CLAIM_NO_RETRY_CONFIRMED_CLOSE");
          if (result.status === "PASS") check(result.sqlStatements === 59 + trace.bodyStatements, "EXACT_ACTUAL_STATEMENTS_INCLUDE_SEPARATE_UPDATE");
          const consumed = await executeImport({ bundle, open, claim, now: () => fixedTime });
          check(consumed.status === "BLOCKED" && consumed.connections === 0 && trace.connects === 1, "CONSUMED_AUTHORIZATION_REUSE_DENIED_BEFORE_CONNECTION");
          return { result, trace, baseline };
        };
        const overBudget = await run();
        check(overBudget.result.status === "BLOCKED" && overBudget.result.importAttempts === 0 && overBudget.trace.imports === 0
          && overBudget.result.rollback === "PASS" && overBudget.result.diagnostic.failureClass === "IMPORT_STATEMENT_BUDGET_EXHAUSTED"
          && canonical(await snapshot()) === canonical(initial), "1704_INSERT_PLAN_BLOCKED_BEFORE_BODY_NO_PARTIAL_EFFECTS");
        // Keep one genuine existing definition so the boundary fixture admits 1703 INSERTs.
        await admin.query(renderReleaseBAuthorizedOperation(prepared.operations.find(op => op.entity === "definition")));
        initial = await snapshot();
        const identityFail = await run({ identityDigest: "a".repeat(64) });
        check(identityFail.result.status === "BLOCKED" && identityFail.result.writeTransactions === 0, "WRONG_PRODUCTION_IDENTITY_BLOCKS_BEFORE_WRITES");
        const approvalFail = await run({ reconciliationDigest: "a".repeat(64) });
        check(approvalFail.result.status === "BLOCKED" && approvalFail.result.writeTransactions === 0, "UNAPPROVED_RECONCILIATION_BLOCKS_BEFORE_WRITES");
        const fixtureSource = await prepareCanonicalCatalogImport({ root, publication: JSON.parse(await readFile(path.join(root, "artifacts/qa/product-publication-cohort-v1/publication-contract.json"), "utf8")) });
        const incompatibleDevice = { ...fixtureSource.devices[0], brand_key: "local-incompatible", publication_status: "draft" };
        await admin.query(renderReleaseBAuthorizedOperation({ entity: "device", row: incompatibleDevice }));
        const conflict = await run();
        check(conflict.result.status === "BLOCKED" && conflict.result.writeTransactions === 0, "INCOMPATIBLE_IDENTITY_PREWRITE_CONFLICT_ABORT");
        await admin.query("DELETE FROM public.devices WHERE slug=$1;", [incompatibleDevice.slug]);
        const failure = await run({ fault: async ({ q }) => { if (q.isImport) throw Object.assign(new Error("private credential payload"), { code: "XX000" }); } });
        check(failure.result.status === "BLOCKED" && failure.result.rollback === "PASS" && failure.trace.imports === 1, "FAILURE_AFTER_REAL_IMPORT_ROLLS_BACK_ATOMICALLY");
        check(failure.trace.bodyStatements === 1706, "1703_INSERT_BOUNDARY_EXECUTES_EXACT_1706_BODY_STATEMENTS");
        check(canonical(await snapshot()) === canonical(initial), "ROLLBACK_NO_PARTIAL_FACT_OR_METADATA_CHANGES");
        check(!canonical(failure.result).includes("credential"), "SAFE_DIAGNOSTIC_SURVIVES_RESULT_WRAPPER");
        const expired = await run({ expire: true });
        check(expired.result.status === "BLOCKED" && !expired.result.commitDispatched && expired.result.rollback === "PASS" && canonical(await snapshot()) === canonical(initial), "WINDOW_EXPIRES_BEFORE_COMMIT_ROLLBACK_NOT_AMBIGUITY");
        const commitRace = await run({ commitRace: true });
        check(commitRace.result.status === "BLOCKED" && !commitRace.result.commitDispatched && commitRace.result.rollback === "PASS"
          && canonical(await snapshot()) === canonical(initial), "FINAL_DISPATCH_GATE_EXPIRY_NEVER_FALSE_COMMIT_AMBIGUITY");
        const actorInitial = { ...initial, auditActor: adminId };
        const generatedInserts = await run({ actor: adminId, fault: async ({ q, result, trace }) => {
          if (q.text === SNAPSHOT_SQL && trace.snapshots === 3) {
            const value = result.rows[0].snapshot;
            check(value.auditEvents.length === 24 && value.auditEvents.every(event => event.action === "insert" && event.actor_id === adminId), "GENUINE_EXPECTED_DEVICE_INSERT_AUDIT_EVENTS");
            check(verifyImport(prepared, actorInitial, value, reconcileImport(prepared, actorInitial)), "EXPECTED_INSERT_EVENT_CONTENT_AND_TARGETS_VERIFIED");
            throw new Error("OWNED_LOCAL_INSERT_AUDIT_ROLLBACK");
          }
        } });
        check(generatedInserts.result.status === "BLOCKED" && generatedInserts.result.rollback === "PASS" && canonical(await snapshot()) === canonical(initial), "GENUINE_INSERT_EVENTS_AND_FACTS_ROLL_BACK_TOGETHER");
        const canonicalPrepared = await prepareCanonicalCatalogImport({ root, publication: JSON.parse(await readFile(path.join(root, "artifacts/qa/product-publication-cohort-v1/publication-contract.json"), "utf8")) });
        for (const row of canonicalPrepared.devices) await admin.query(renderReleaseBAuthorizedOperation({ entity: "device", row: { ...row, schema_type: null } }));
        const legacyBaseline = await snapshot();
        check(legacyBaseline.devices.length === 24 && legacyBaseline.devices.every(d => d.schema_type === null), "EXISTING_24_LEGACY_DEVICES_WITH_NULL_SCHEMA_METADATA");
        check(legacyBaseline.auditEvents.length === 0, "LEGITIMATE_PRE_AUDIT_ROWS_HAVE_NO_FABRICATED_EVENTS");
        const good = await run({ actor: adminId });
        check(good.result.status === "PASS" && good.result.postCommitVerification === "PASS" && good.result.writeTransactions === 1 && good.result.readStatements === 49
          && good.result.dispatches === 60 && good.result.sqlStatements <= packet.executionContract.importSqlStatementsMax
          && !good.trace.queries.includes(STATE_SQL), "INITIAL_SEGMENTED_IMPORT_ALL_FOUR_BOUNDARIES_AND_EXACT_BUDGETS");
        check(good.result.inserts.device === 0 && good.result.nullSchemaTypeUpdates === 24, "NULL_SCHEMA_ONLY_NO_EXISTING_DEVICE_REPLACEMENT");
        for (const n of [1, 3]) {
          const rows = (await snapshot()).specs.filter(row => !["KNOWN", "CONFLICT"].includes(row.state)).slice(0, n);
          await admin.query("DELETE FROM public.device_specs WHERE id=ANY($1::uuid[]);", [rows.map(row => row.id)]);
          const inserted = await run();
          check(inserted.result.status === "PASS" && inserted.result.inserts.spec === n && inserted.trace.bodyStatements === 3 + n
            && inserted.result.sqlStatements === 62 + n, `GENUINE_${n}_INSERT_EXACT_BODY_AND_TOTAL_STATEMENTS`);
        }
        const stored = await snapshot();
        check(stored.auditEvents.length === 24 && stored.auditEvents.every(event => event.entity_type === "device" && event.action === "update"
          && event.actor_id === adminId && canonical(event.changed_fields) === canonical({ fields: ["schema_type"] })), "EXACT_REAL_TRIGGER_EVENTS_FOR_NULL_SCHEMA_INITIALIZATION");
        check(stored.devices.length === 24 && stored.specs.length === 1488, "EXACT_24_DEVICES_1488_SPEC_IDENTITIES");
        check(stored.devices.every(d => !d.catalog_normalized), "IMPORT_WITHOUT_ACTIVATION");
        check(stored.specs.filter(s => ["KNOWN", "CONFLICT"].includes(s.state)).length === 829, "829_KNOWN_SOURCE_VALUES_RECONCILED_ZERO_DROPS");
        check(stored.specs.filter(s => !["KNOWN", "CONFLICT"].includes(s.state)).every(s => [s.value_number, s.value_boolean, s.value_text, s.value_json].every(v => v === null)), "UNKNOWN_VALUES_NOT_FABRICATED");
        check(stored.evidence.length === 15 && stored.sourceLinks.length === 46 && stored.sources.length === 39, "SOURCE_LINKS_AND_APPROVED_CONFLICT_EVIDENCE_INTACT");
        const repeat = await run();
        check(repeat.result.status === "PASS" && Object.values(repeat.result.inserts).every(n => n === 0) && repeat.result.nullSchemaTypeUpdates === 0 && canonical(await snapshot()) === canonical(stored), "EXISTING_24_1488_REPEAT_IS_IDEMPOTENT");
        check(canonical(repeat.trace.bodyCommands) === canonical(["SET", "DO", "UPDATE"]) && repeat.trace.updatedRows === 0
          && repeat.trace.bodyStatements === 3 && repeat.result.sqlStatements === 62, "ZERO_INSERT_EXECUTES_THREE_STATEMENTS_ZERO_UPDATE_OR_AUDIT_EFFECT");
        await admin.query("BEGIN; LOCK TABLE public.devices IN ROW EXCLUSIVE MODE;");
        try {
          const blockedLock = await run();
          check(blockedLock.result.status === "BLOCKED" && blockedLock.result.importAttempts === 0 && blockedLock.result.rollback === "PASS"
            && blockedLock.result.diagnostic.failureClass === "POSTGRES_LOCK_TIMEOUT", "GENUINE_CATALOG_WRITER_LOCK_BLOCKS_BEFORE_IMPORT_BODY");
        } finally { await admin.query("ROLLBACK;"); }
        await admin.query("BEGIN; SET LOCAL ROLE anon;");
        const legacy = await admin.query("SELECT slug,full_specs,key_specs FROM public.devices WHERE slug='xreal-air';");
        await admin.query("ROLLBACK;");
        check(legacy.rows.length === 1 && legacy.rows[0].full_specs && legacy.rows[0].key_specs, "CURRENT_ANON_LEGACY_READER_GRANTS_AND_JSON_PRESERVED");
        const known = stored.specs.filter(s => s.state === "KNOWN" && s.value_text !== null);
        await admin.query("BEGIN; SET LOCAL ROLE authenticated;");
        await admin.query("SELECT set_config('request.jwt.claims',$1,true);", [JSON.stringify({ sub: adminId, role: "authenticated" })]);
        await admin.query("SELECT public.save_catalog_spec($1,$2,$3);", [known[0].device_id, known[0].id,
          { valueText: "LOCAL_ADMIN_VALUE", presentation: { labelEn: "Admin label", labelZh: "Local label", keySpec: true, groupKey: "owned_local_group" } }]);
        await admin.query("SELECT public.save_catalog_group($1,$2,$3);", [known[0].device_id, "owned_local_group", { groupEn: "Owned local group" }]);
        await admin.query("COMMIT;");
        await admin.query("UPDATE public.device_specs SET value_text='LOCAL_RICHER_VALUE' WHERE id=$1;", [known[1].id]);
        await admin.query("UPDATE public.devices SET publication_status='hidden',short_description='LOCAL_RICHER_COPY' WHERE slug='xreal-air';");
        const adminBaseline = await snapshot(); const adminPlan = reconcileImport(prepared, adminBaseline);
        const adminProvenance = adminPlan.audit.provenance.find(row => row.entity === "spec" && row.identity === canonical([known[0].deviceSlug, known[0].definitionKey, known[0].region, known[0].variant]));
        check(adminProvenance?.classification === "RECORDED_ADMIN_WRITE" && adminProvenance.eventCount === 2, "GENUINE_ADMIN_SPEC_AND_GROUP_RPC_PROVENANCE");
        check(!canonical(adminPlan).includes(adminId) && !canonical(adminPlan).includes("LOCAL_ADMIN_VALUE"), "NO_RAW_ACTOR_OR_VALUE_IN_RECONCILIATION_REPORT");
        check(adminPlan.actions.some(a => a.classification === "PRESERVE_ADMIN_VALUE") && adminPlan.actions.some(a => a.classification === "PRESERVE_EXISTING_RICHER_VALUE"), "DETERMINISTIC_ADMIN_RICHER_CLASSIFICATIONS");
        const preserve = await run();
        check(preserve.result.status === "PASS" && canonical(await snapshot()) === canonical(adminBaseline), "ADMIN_FACTS_PRESENTATION_COPY_AND_HIDDEN_STATUS_PRESERVED");
        const auditFault = async (stage, alter) => run({ fault: async ({ q, result, trace }) => {
          if (q.text === SNAPSHOT_SQL && trace.snapshots === stage) alter(result.rows[0].snapshot);
        } });
        const alterPayload = value => { value.auditEvents[0].changed_fields = { fields: ["name"] }; };
        const auditApprovalDrift = await auditFault(1, alterPayload);
        check(auditApprovalDrift.result.status === "BLOCKED" && auditApprovalDrift.result.writeTransactions === 0, "SAME_COUNT_AUDIT_TAMPER_INVALIDATES_APPROVED_RECONCILIATION");
        const auditLockedDrift = await auditFault(2, alterPayload);
        check(auditLockedDrift.result.status === "BLOCKED" && auditLockedDrift.result.importAttempts === 0, "LOCKED_AUDIT_CONTENT_DRIFT_BLOCKS_IMPORT");
        for (const [label, alter] of [
          ["SAME_COUNT_AUDIT_CONTENT_TAMPER_PRECOMMIT", alterPayload],
          ["AUDIT_DELETION_PRECOMMIT", value => { value.auditEvents.shift(); }],
          ["AUDIT_SUBSTITUTION_PRECOMMIT", value => { value.auditEvents[0].id = randomUUID(); }],
          ["UNEXPECTED_NEW_AUDIT_EVENT_PRECOMMIT", value => { value.auditEvents.push({ ...value.auditEvents[0], id: randomUUID() }); }],
        ]) {
          const failure = await auditFault(3, alter);
          check(failure.result.status === "BLOCKED" && failure.result.rollback === "PASS" && !failure.result.commitDispatched
            && failure.result.diagnostic.failureClass.startsWith("IMPORT_AUDIT_"), label);
          check(canonical(await snapshot()) === canonical(adminBaseline), label + "_NO_REAL_CHANGES");
        }
        const auditPostFailure = await auditFault(4, alterPayload);
        check(auditPostFailure.result.status === "COMMITTED_VERIFICATION_FAILED" && auditPostFailure.result.committed
          && auditPostFailure.result.diagnostic.failureClass === "IMPORT_AUDIT_EXISTING_EVENT_CHANGED_OR_REMOVED", "POSTCOMMIT_AUDIT_CONTENT_RECHECK_NOT_FALSE_PASS");
        const contradictoryActor = await auditFault(1, value => {
          value.auditEvents.find(event => event.entity_type === "device_spec" && event.entity_id === known[0].id).actor_id = randomUUID();
        });
        check(contradictoryActor.result.status === "BLOCKED" && contradictoryActor.result.writeTransactions === 0, "CONTRADICTORY_GENUINE_RPC_ACTOR_EVIDENCE_REJECTED");
        await admin.query("UPDATE public.device_specs SET state='NOT_DISCLOSED',value_text=null,raw_value='Not disclosed' WHERE id=$1;", [known[2].id]);
        const unknownBaseline = await snapshot();
        const emptyFail = await run();
        check(emptyFail.result.status === "BLOCKED" && emptyFail.result.writeTransactions === 0 && canonical(await snapshot()) === canonical(unknownBaseline), "EXISTING_EMPTY_NOT_SILENTLY_OVERWRITTEN_ADJUDICATION_REQUIRED");
        await admin.query("UPDATE public.device_specs SET state='KNOWN',value_text=$1,raw_value=$2 WHERE id=$3;", [known[2].value_text, known[2].raw_value, known[2].id]);
        const claim = stored.evidence.find(e => e.is_conflicting);
        await admin.query("UPDATE public.device_spec_evidence SET claimed_value='LOCAL_NEW_AUTHORITATIVE_CONFLICT' WHERE id=$1;", [claim.id]);
        const evidenceConflict = await run();
        check(evidenceConflict.result.status === "BLOCKED" && evidenceConflict.result.importAttempts === 0, "NEW_AUTHORITATIVE_CONFLICT_REQUIRES_ADJUDICATION");
        await admin.query("UPDATE public.device_spec_evidence SET claimed_value=$1 WHERE id=$2;", [claim.claimed_value, claim.id]);
        const concurrent = await run({ fault: async ({ q, result, trace }) => { if (q.text === SNAPSHOT_SQL && trace.snapshots === 2) result.rows[0].snapshot.devices[0].name = "SIMULATED_CONCURRENT_DRIFT"; } });
        check(concurrent.result.status === "BLOCKED" && concurrent.result.importAttempts === 0 && concurrent.result.rollback === "PASS", "LOCKED_SNAPSHOT_RECHECK_ABORTS_CONCURRENT_DRIFT");
        const realBefore = await snapshot();
        const realConcurrent = await run({ fault: async ({ q, trace }) => {
          if (q.text === "COMMIT;" && trace.snapshots === 1 && trace.imports === 0) await admin.query("UPDATE public.devices SET short_description='OWNED_CONCURRENT_CHANGE' WHERE slug=$1;", [realBefore.devices[0].slug]);
        } });
        check(realConcurrent.result.status === "BLOCKED" && realConcurrent.result.importAttempts === 0 && realConcurrent.result.rollback === "PASS", "GENUINE_DB_CHANGE_BETWEEN_TRANSACTIONS_BLOCKS_LOCKED_REVALIDATION");
        await admin.query("UPDATE public.devices SET short_description=$1 WHERE slug=$2;", [realBefore.devices[0].short_description, realBefore.devices[0].slug]);
        const postFail = await run({ fault: async ({ q, trace }) => { if (q.text === SNAPSHOT_SQL && trace.snapshots === 4) throw new Error("INJECTED_POSTCOMMIT_FAILURE"); } });
        check(postFail.result.status === "COMMITTED_VERIFICATION_FAILED" && postFail.result.committed, "POSTCOMMIT_FAILURE_NOT_FALSE_PASS_OR_RETRY");
        const ambiguous = await run({ fault: async ({ q, trace }) => { if (q.text === "COMMIT;" && trace.imports && trace.snapshots === 3) throw new Error("INJECTED_LOST_COMMIT_ACK"); } });
        check(ambiguous.result.status === "AMBIGUOUS" && ambiguous.result.commitDispatched && !ambiguous.trace.queries.includes("ROLLBACK;"), "COMMIT_DISPATCHED_AMBIGUITY_NO_ROLLBACK_RECONNECT_RETRY");
        receipt.knownValuesReconciled = 829; receipt.targetDevices = 24; receipt.targetSpecs = 1488;
        receipt.evidenceClass = "GENUINE_OWNED_LOOPBACK_POSTGRES_STAGE2_FROZEN_IMPORT_SQL";
        return { status: "PASS" };
      } finally { await admin.end(); }
    } }));
  receipt.status = "PASS"; receipt.cleanup = "PASS";
} catch (error) { receipt.firstFailure = error instanceof assert.AssertionError ? error.message : "OWNED_LOCAL_REHEARSAL_FAILED"; receipt.fixtureDiagnostic = safeImportFailure(error, "VERIFY", 0, false); process.exitCode = 1; }
const directory = path.join(root, "artifacts/qa/catalog-stage-c-import"); await mkdir(directory, { recursive: true });
const file = path.join(directory, runId + ".json"); await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(receipt)); console.log("RECEIPT=" + file);
