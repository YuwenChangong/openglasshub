import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { withCanonicalBaselineDirectory, runLocalDisposableReplay, assertLocalReplayTarget } from "./local-disposable-supabase-replay.mjs";
import { IDENTITY_SQL, STATE_SQL } from "./lib/catalog-production-migration-transport.mjs";
import { prepareImport, reconcileImport, canonical, sha256, SNAPSHOT_SQL } from "./lib/catalog-production-import.mjs";
import { createImportPacket, loadImportBundle, executeImport, claimImportAuthorization, readImportReconciliation } from "./lib/catalog-production-import-executor.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
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
        const identitySha256 = sha256(JSON.stringify({ database: identity.database, role: identity.role, port: identity.port, system_identifier: identity.system_identifier }));
        const snapshot = async () => (await admin.query(SNAPSHOT_SQL)).rows[0].snapshot;
        const initial = await snapshot();
        const fixedTime = Date.parse("2020-01-01T00:01:00Z");
        const read = await readImportReconciliation({ packet, prepared, session: admin, expectedServerIdentitySha256: identitySha256 });
        check(read.inserts.device === 24 && read.inserts.spec === 1488 && read.blockers.length === 0, "GENUINE_STATE2_INITIAL_RECONCILIATION");
        const run = async ({ fault, identityDigest = identitySha256, reconciliationDigest, expire } = {}) => {
          const baseline = await snapshot();
          const plan = reconcileImport(prepared, baseline);
          const authorizationId = "stage-c-local-" + randomUUID();
          const auth = { format: "catalog-stage-c-authorization-v1", authorizationId, packetSha256: sha256(canonical(packet)), candidateHead: packet.candidateHead,
            checkoutSha256: packet.checkoutSha256, targetClass: "SUPAVISOR_SESSION", serverIdentitySha256: identityDigest, reconciliationSha256: reconciliationDigest ?? plan.reconciliationSha256,
            windowStartUTC: "2020-01-01T00:00:00Z", windowEndUTC: "2020-01-01T00:10:00Z", humanGates: { backupRecoveryReady: true, catalogWritesPaused: true, currentReaderCompatible: true,
              stageBCompleted: true, productionReconciliationReviewed: true, rollbackOperatorReady: true } };
          const bundle = await loadImportBundle({ root, packet, receipt: auth, now: fixedTime });
          let clock = fixedTime;
          const trace = { connects: 0, queries: [], snapshots: 0, imports: 0 };
          class OwnedClient {
            constructor() { this.client = new pg.Client(config); }
            on(...args) { return this.client.on(...args); }
            async connect() { trace.connects++; await this.client.connect(); }
            async query(q) {
              trace.queries.push(q.text); if (q.text === SNAPSHOT_SQL) trace.snapshots++;
              if (q.text === prepared.body) trace.imports++;
              const result = await this.client.query(q);
              if (expire && q.text === STATE_SQL && trace.imports > 0) clock = Date.parse(auth.windowEndUTC);
              await fault?.({ q, client: this.client, trace, result }); return result;
            }
            async end() { await this.client.end(); }
          }
          const open = createImportPostgresAdapter({ config, Client: OwnedClient });
          const claim = (id, digest) => claimImportAuthorization(root, id, digest);
          const result = await executeImport({ bundle, open, claim, now: () => clock });
          check(trace.connects === 1 && result.authorizationConsumed && result.automaticRetries === 0, "ONE_CONNECTION_DURABLE_CLAIM_NO_RETRY");
          const consumed = await executeImport({ bundle, open, claim, now: () => fixedTime });
          check(consumed.status === "BLOCKED" && consumed.connections === 0 && trace.connects === 1, "CONSUMED_AUTHORIZATION_REUSE_DENIED_BEFORE_CONNECTION");
          return { result, trace, baseline };
        };
        const identityFail = await run({ identityDigest: "a".repeat(64) });
        check(identityFail.result.status === "BLOCKED" && identityFail.result.writeTransactions === 0, "WRONG_PRODUCTION_IDENTITY_BLOCKS_BEFORE_WRITES");
        const approvalFail = await run({ reconciliationDigest: "a".repeat(64) });
        check(approvalFail.result.status === "BLOCKED" && approvalFail.result.writeTransactions === 0, "UNAPPROVED_RECONCILIATION_BLOCKS_BEFORE_WRITES");
        const failure = await run({ fault: async ({ q }) => { if (q.text === prepared.body) throw Object.assign(new Error("private credential payload"), { code: "XX000" }); } });
        check(failure.result.status === "BLOCKED" && failure.result.rollback === "PASS" && failure.trace.imports === 1, "FAILURE_AFTER_REAL_IMPORT_ROLLS_BACK_ATOMICALLY");
        check(canonical(await snapshot()) === canonical(initial), "ROLLBACK_NO_PARTIAL_FACT_OR_METADATA_CHANGES");
        check(!canonical(failure.result).includes("credential"), "SAFE_DIAGNOSTIC_SURVIVES_RESULT_WRAPPER");
        const expired = await run({ expire: true });
        check(expired.result.status === "BLOCKED" && !expired.result.commitDispatched && expired.result.rollback === "PASS" && canonical(await snapshot()) === canonical(initial), "WINDOW_EXPIRES_BEFORE_COMMIT_ROLLBACK_NOT_AMBIGUITY");
        const canonicalPrepared = await prepareCanonicalCatalogImport({ root, publication: JSON.parse(await readFile(path.join(root, "artifacts/qa/product-publication-cohort-v1/publication-contract.json"), "utf8")) });
        for (const row of canonicalPrepared.devices) await admin.query(renderReleaseBAuthorizedOperation({ entity: "device", row: { ...row, schema_type: null } }));
        const legacyBaseline = await snapshot();
        check(legacyBaseline.devices.length === 24 && legacyBaseline.devices.every(d => d.schema_type === null), "EXISTING_24_LEGACY_DEVICES_WITH_NULL_SCHEMA_METADATA");
        const good = await run();
        check(good.result.status === "PASS" && good.result.postCommitVerification === "PASS" && good.result.writeTransactions === 1 && good.result.readStatements === 9, "INITIAL_ATOMIC_IMPORT_POSTCOMMIT_BUDGETS");
        check(good.result.inserts.device === 0 && good.result.nullSchemaTypeUpdates === 24, "NULL_SCHEMA_ONLY_NO_EXISTING_DEVICE_REPLACEMENT");
        const stored = await snapshot();
        check(stored.devices.length === 24 && stored.specs.length === 1488, "EXACT_24_DEVICES_1488_SPEC_IDENTITIES");
        check(stored.devices.every(d => !d.catalog_normalized), "IMPORT_WITHOUT_ACTIVATION");
        check(stored.specs.filter(s => ["KNOWN", "CONFLICT"].includes(s.state)).length === 829, "829_KNOWN_SOURCE_VALUES_RECONCILED_ZERO_DROPS");
        check(stored.specs.filter(s => !["KNOWN", "CONFLICT"].includes(s.state)).every(s => [s.value_number, s.value_boolean, s.value_text, s.value_json].every(v => v === null)), "UNKNOWN_VALUES_NOT_FABRICATED");
        check(stored.evidence.length === 15 && stored.sourceLinks.length === 46 && stored.sources.length === 39, "SOURCE_LINKS_AND_APPROVED_CONFLICT_EVIDENCE_INTACT");
        const repeat = await run();
        check(repeat.result.status === "PASS" && Object.values(repeat.result.inserts).every(n => n === 0) && repeat.result.nullSchemaTypeUpdates === 0 && canonical(await snapshot()) === canonical(stored), "EXISTING_24_1488_REPEAT_IS_IDEMPOTENT");
        await admin.query("BEGIN; SET LOCAL ROLE anon;");
        const legacy = await admin.query("SELECT slug,full_specs,key_specs FROM public.devices WHERE slug='xreal-air';");
        await admin.query("ROLLBACK;");
        check(legacy.rows.length === 1 && legacy.rows[0].full_specs && legacy.rows[0].key_specs, "CURRENT_ANON_LEGACY_READER_GRANTS_AND_JSON_PRESERVED");
        const known = stored.specs.filter(s => s.state === "KNOWN" && s.value_text !== null);
        const adminId = randomUUID();
        await admin.query("INSERT INTO auth.users(id,email) VALUES ($1,$2);", [adminId, "stage-c-owned-local@example.invalid"]);
        await admin.query("UPDATE public.device_specs SET value_text='LOCAL_ADMIN_VALUE',updated_by=$1,presentation=$2 WHERE id=$3;", [adminId, { labelEn: "Admin label", labelZh: "Local label", keySpec: true }, known[0].id]);
        await admin.query("UPDATE public.device_specs SET value_text='LOCAL_RICHER_VALUE' WHERE id=$1;", [known[1].id]);
        await admin.query("UPDATE public.devices SET publication_status='hidden',short_description='LOCAL_RICHER_COPY' WHERE slug='xreal-air';");
        const adminBaseline = await snapshot(); const adminPlan = reconcileImport(prepared, adminBaseline);
        check(adminPlan.actions.some(a => a.classification === "PRESERVE_ADMIN_VALUE") && adminPlan.actions.some(a => a.classification === "PRESERVE_EXISTING_RICHER_VALUE"), "DETERMINISTIC_ADMIN_RICHER_CLASSIFICATIONS");
        const preserve = await run();
        check(preserve.result.status === "PASS" && canonical(await snapshot()) === canonical(adminBaseline), "ADMIN_FACTS_PRESENTATION_COPY_AND_HIDDEN_STATUS_PRESERVED");
        await admin.query("UPDATE public.device_specs SET state='NOT_DISCLOSED',value_text=null,raw_value='Not disclosed' WHERE id=$1;", [known[2].id]);
        const unknownBaseline = await snapshot();
        const emptyFail = await run();
        check(emptyFail.result.status === "BLOCKED" && emptyFail.result.writeTransactions === 0 && canonical(await snapshot()) === canonical(unknownBaseline), "EXISTING_EMPTY_NOT_SILENTLY_OVERWRITTEN_ADJUDICATION_REQUIRED");
        await admin.query("UPDATE public.device_specs SET state='KNOWN',value_text=$1,raw_value=$2 WHERE id=$3;", [known[2].value_text, known[2].raw_value, known[2].id]);
        await admin.query("UPDATE public.devices SET brand_key='local-incompatible' WHERE slug='xreal-air';");
        const conflict = await run();
        check(conflict.result.status === "BLOCKED" && conflict.result.writeTransactions === 0, "INCOMPATIBLE_IDENTITY_PREWRITE_CONFLICT_ABORT");
        await admin.query("UPDATE public.devices SET brand_key='xreal' WHERE slug='xreal-air';");
        const claim = stored.evidence.find(e => e.is_conflicting);
        await admin.query("UPDATE public.device_spec_evidence SET claimed_value='LOCAL_NEW_AUTHORITATIVE_CONFLICT' WHERE id=$1;", [claim.id]);
        const evidenceConflict = await run();
        check(evidenceConflict.result.status === "BLOCKED" && evidenceConflict.result.importAttempts === 0, "NEW_AUTHORITATIVE_CONFLICT_REQUIRES_ADJUDICATION");
        await admin.query("UPDATE public.device_spec_evidence SET claimed_value=$1 WHERE id=$2;", [claim.claimed_value, claim.id]);
        const concurrent = await run({ fault: async ({ q, result, trace }) => { if (q.text === SNAPSHOT_SQL && trace.snapshots === 2) result.rows[0].snapshot.devices[0].name = "SIMULATED_CONCURRENT_DRIFT"; } });
        check(concurrent.result.status === "BLOCKED" && concurrent.result.importAttempts === 0 && concurrent.result.rollback === "PASS", "LOCKED_SNAPSHOT_RECHECK_ABORTS_CONCURRENT_DRIFT");
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
} catch (error) { receipt.firstFailure = error instanceof assert.AssertionError ? error.message : /^IMPORT_[A-Z0-9_]+$/.test(error?.importCode ?? "") ? error.importCode : "OWNED_LOCAL_REHEARSAL_FAILED"; process.exitCode = 1; }
const directory = path.join(root, "artifacts/qa/catalog-stage-c-import"); await mkdir(directory, { recursive: true });
const file = path.join(directory, runId + ".json"); await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(receipt)); console.log("RECEIPT=" + file);
