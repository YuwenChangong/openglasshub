import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runLocalDisposableReplay } from "./local-disposable-supabase-replay.mjs";
import { createReleaseBTestFixture } from "./release-b-test-fixture.mjs";
import { createReleaseBDisposableTransport } from "./release-b-disposable-transport.mjs";
import { createReleaseBProductionTransport } from "./lib/release-b-production-transport.mjs";
import { computeReleaseBExecutionSurfaceFingerprints, createReleaseBAuthorizationReceiptV4, hashAuthorizationReceipt } from "./release-b-production-import.mjs";
import { parseSchemaV1SqlState, readSchemaV1SqlVerification } from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";

function disposableEnvironment() {
  const {
    P9_PRODUCTION_DATABASE_URL: _p9ProductionDatabaseUrl,
    PGHOST: _pgHost,
    PGPORT: _pgPort,
    PGDATABASE: _pgDatabase,
    PGUSER: _pgUser,
    PGPASSWORD: _pgPassword,
    DATABASE_URL: _databaseUrl,
    ...safe
  } = process.env;
  return safe;
}

const fixture = await createReleaseBTestFixture();
try {
  const replay = await runLocalDisposableReplay({
    environment: disposableEnvironment(),
    afterMigrationLedgerValidated: async ({ executeSql, createSqlSession, canonicalMigrationCount }) => {
      assert.equal(canonicalMigrationCount, 50);
      assert.equal(typeof createSqlSession, "function", "the owned replay exposes a persistent local PostgreSQL session");
      let attempts = 0;
      const transcripts = [];
      const createSession = () => {
        attempts++;
        const session = createSqlSession();
        const transcript = [];
        transcripts.push(transcript);
        return { async query(sql) { transcript.push(sql); return session.query(sql); }, close: () => session.close() };
      };
      const productionAdapterEnvironment = { P9_PRODUCTION_DATABASE_URL: "postgresql://postgres.xcbnxzjlsvtgzixurcof:owned-disposable@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require" };
      const productionAdapterTranscripts = [];
      const createOwnedProductionAdapter = ({ precheckOverride } = {}) => createReleaseBProductionTransport({
        environment: productionAdapterEnvironment,
        createSession: () => {
          const session = createSqlSession();
          const transcript = [];
          productionAdapterTranscripts.push(transcript);
          return {
            targetIdentity: { projectRef: "xcbnxzjlsvtgzixurcof", host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 5432, database: "postgres", databaseRole: "postgres", endpointClass: "SUPAVISOR_SESSION" },
            async query(sql) {
              if (sql.startsWith("SELECT current_database")) {
                await session.query("SELECT 1;");
                return { rows: [{ current_database: "postgres", current_user: "postgres", server_port: "5432" }] };
              }
              transcript.push(sql);
              const output = await session.query(sql);
              if (sql.startsWith("LOCK TABLE")) return { rows: [{ release_b_state: precheckOverride ?? parseSchemaV1SqlState(output) }] };
              if (sql.startsWith("UPDATE public.devices") && sql.includes(" RETURNING 1 AS updated")) {
                const lines = String(output).trim().split(/\r?\n/);
                return { rows: lines[0] === "updated" && lines[1] === "1" ? [{ updated: 1 }] : [], rowCount: lines[0] === "updated" && lines[1] === "1" ? 1 : 0 };
              }
              return { rows: [] };
            },
            close: () => session.close(),
          };
        },
        readPostcheck: async ({ queryReadOnly }) => {
          await queryReadOnly("SELECT 1;");
          return { counts: { devices: 24, deviceSpecDefinitions: 92, deviceSpecs: 1488, deviceSources: 39, deviceSourceLinks: 46, deviceSpecEvidence: 15, catalogAuditEvents: 0 }, uniqueSlugs: 24, publishedDevices: 24, conflictInvariants: "PASS", rayBanIdentity: "ray-ban-meta", unexpectedDeletes: 0 };
        },
      });
      const transport = createReleaseBDisposableTransport({ executeSql, createSession });
      const executionSurface = await computeReleaseBExecutionSurfaceFingerprints();
      const receiptFor = (approvalId) => createReleaseBAuthorizationReceiptV4({
        approvalId,
        authorizedAtUtc: "2026-09-21T00:00:00Z",
        frozen: fixture.frozen,
        executionSurface,
      });
      const invoke = (approvalId, selectedTransport = transport) => {
        const authorizationReceipt = receiptFor(approvalId);
        return fixture.execute({ args: ["--execute-production"], authorizationReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt), transport: selectedTransport });
      };
      const assertEmpty = async () => {
        const counts = await readSchemaV1SqlVerification({ executeSql });
        assert.equal(counts.devices + counts.definitions + counts.specs + counts.sources + counts.sourceLinks + counts.evidence + counts.auditEvents, 0, "failed executor transaction leaves zero committed application rows");
      };

      // The reviewed Production adapter is exercised against this owned local
      // endpoint wrapper; no Production socket is opened. A real transaction-
      // bound precheck mismatch must receive an acknowledged SQL rollback.
      const adapterDriftState = { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: { devices: 1, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 } };
      await assert.rejects(() => invoke("release-b-approval-6999", createOwnedProductionAdapter({ precheckOverride: adapterDriftState })), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/, "the actual Production adapter rejects a transaction-bound precheck mismatch");
      const adapterTranscript = productionAdapterTranscripts.find((entry) => entry.some((sql) => sql.startsWith("BEGIN;")));
      assert.ok(adapterTranscript, "the actual Production adapter opened a transaction session");
      assert.equal(adapterTranscript.at(-1), "ROLLBACK;", "the actual Production adapter acknowledged rollback after precheck drift");
      assert.equal(adapterTranscript.some((sql) => sql.startsWith("INSERT INTO")), false, "the actual Production adapter sends no write after precheck drift");
      await assertEmpty();

      // Introduce actual concurrent drift after BEGIN, before the locked read.
      const driftTransport = createReleaseBDisposableTransport({ executeSql, createSession: () => {
        const session = createSession();
        return { async query(sql) {
          const result = await session.query(sql);
          if (sql.startsWith("BEGIN;")) await executeSql("INSERT INTO public.device_sources (url, publisher, source_type, accessed_at) VALUES ('https://task18.test/drift', 'Task18', 'official_spec_sheet', CURRENT_DATE);");
          return result;
        }, close: () => session.close() };
      } });
      await assert.rejects(() => invoke("release-b-approval-7001", driftTransport), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/);
      assert.equal(transcripts[0].at(-1), "ROLLBACK;");
      assert.ok(transcripts[0].every((sql) => !sql.includes("INSERT INTO")), "real count drift blocks every executor write");
      await executeSql("DELETE FROM public.device_sources WHERE url = 'https://task18.test/drift';");
      await assertEmpty();

      // The immutable valid payload fails late at a real, test-owned CHECK constraint.
      await executeSql("ALTER TABLE public.device_spec_evidence ADD CONSTRAINT task18_late_failure CHECK (false);");
      await assert.rejects(() => invoke("release-b-approval-7002"), (error) => error.sqlState === "23514", "late PostgreSQL CHECK violation must reject the new executor");
      await assertEmpty();
      assert.match(transcripts[1].at(-2), /INSERT INTO public\.device_spec_evidence/);
      const beforeRetry = attempts;
      await assert.rejects(() => invoke("release-b-approval-7002"), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
      assert.equal(attempts, beforeRetry, "failed receipt cannot open a second SQL transaction");
      await executeSql("ALTER TABLE public.device_spec_evidence DROP CONSTRAINT task18_late_failure;");

      let competingWriteBlocked = false;
      const lockedTransport = createReleaseBDisposableTransport({ executeSql, createSession: () => {
        const session = createSession();
        return { async query(sql) {
          const result = await session.query(sql);
          if (sql.startsWith("LOCK TABLE")) {
            await assert.rejects(() => executeSql("SET lock_timeout = '200ms'; INSERT INTO public.device_sources (url, publisher, source_type, accessed_at) VALUES ('https://task18.test/concurrent', 'Task18', 'official_spec_sheet', CURRENT_DATE);"), (error) => error.sqlState === "55P03", "a real competing writer is blocked by the transaction's table locks");
            competingWriteBlocked = true;
          }
          return result;
        }, close: () => session.close() };
      } });
      const successful = await invoke("release-b-approval-7003", lockedTransport);
      assert.equal(successful.status, "COMMITTED");
      assert.equal(competingWriteBlocked, true);
      assert.equal(transcripts[2].filter((sql) => sql.startsWith("BEGIN;")).length, 1);
      assert.match(transcripts[2][1], /^LOCK TABLE/);
      assert.match(transcripts[2][2], /^INSERT INTO/);
      assert.match(transcripts[2][2], /COMMIT;\s*$/);
      assert.equal(JSON.parse(await readFile(successful.consumptionPath, "utf8")).status, "STARTED");
      await assert.rejects(() => invoke("release-b-approval-7003"), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
      assert.equal(attempts, 3);
      const counts = await readSchemaV1SqlVerification({ executeSql });
      assert.deepEqual([counts.devices, counts.definitions, counts.specs, counts.sources, counts.sourceLinks, counts.evidence, counts.auditEvents, counts.uniqueSlugs, counts.published], [24, 92, 1488, 39, 46, 15, 0, 24, 24]);
      return { executor: "PASS", transactions: attempts, committedTransactions: 1, constraintSqlState: "23514", rowsCommittedAfterFailure: 0, lockedDriftRejection: "PASS", competingWriter: "BLOCKED", doubleConsumption: "REJECTED" };
    },
  });
  console.log(`RELEASE_B_PRODUCTION_DISPOSABLE_REHEARSAL_OK ${JSON.stringify(replay.afterMigrationLedgerValidated)}`);
} finally { await fixture.close(); }
