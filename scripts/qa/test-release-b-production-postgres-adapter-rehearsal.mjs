import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { readSchemaV1SqlVerification } from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";
import { runLocalDisposableReplay } from "./local-disposable-supabase-replay.mjs";
import { createReleaseBTestFixture } from "./release-b-test-fixture.mjs";
import {
  computeReleaseBExecutionSurfaceFingerprints,
  createReleaseBAuthorizationReceiptV4,
  hashAuthorizationReceipt,
} from "./release-b-production-import.mjs";
import { runReleaseBProductionRunner } from "./release-b-production-runner.mjs";

const SESSION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const EXPECTED_COUNTS = Object.freeze([24, 92, 1488, 39, 46, 15, 0, 24, 24]);
const TEST_CA_ENV = "P9_PRODUCTION_DATABASE_CA_CERT_PATH";
const execFile = promisify(execFileCallback);

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

function parseCsvRows(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
}

function createDisposablePostgresClient({ createSqlSession, state }) {
  return class DisposablePostgresClient {
    constructor(config) {
      assert.equal(typeof config?.ssl?.ca, "string", "adapter must pass explicit CA trust to the client boundary");
      assert.equal(config?.ssl?.rejectUnauthorized, true, "adapter must preserve verified TLS configuration even in local client injection");
      assert.equal(Object.hasOwn(config, "password"), true, "adapter passes the parsed in-memory credential to the client boundary");
      state.constructed += 1;
      this.session = null;
    }

    async connect() {
      state.connects += 1;
      this.session = createSqlSession();
    }

    async query(sql, params = []) {
      assert.ok(this.session, "query requires an opened disposable session");
      assert.deepEqual(params, [], "Release B rehearsal SQL is rendered by reviewed transport/executor boundaries");
      state.queries.push(sql);
      const output = await this.session.query(sql);

      if (sql.startsWith("SELECT current_database")) {
        return { rows: [{ current_database: "postgres", current_user: "postgres", server_port: "5432" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE public.devices") && sql.includes(" RETURNING 1 AS updated")) {
        const rows = parseCsvRows(output);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("LOCK TABLE")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT encode")) {
        if (state.precheckDrift) {
          state.precheckDrift = false;
          return {
            rows: [{
              release_b_state: {
                releaseAHistory: "PRESENT",
                schemaPostconditions: "PASS",
                releaseBApplied: false,
                counts: {
                  devices: 1,
                  deviceSpecDefinitions: 0,
                  deviceSpecs: 0,
                  deviceSources: 0,
                  deviceSourceLinks: 0,
                  deviceSpecEvidence: 0,
                  catalogAuditEvents: 0,
                },
              },
            }],
            rowCount: 1,
          };
        }
        const rows = parseCsvRows(output);
        return { rows: rows.map((row) => ({ release_b_state: JSON.parse(Buffer.from(row.payload, "hex").toString("utf8")) })), rowCount: rows.length };
      }
      if (/^\s*(?:WITH|SELECT)\b/i.test(sql)) {
        const rows = parseCsvRows(output);
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }

    async end() {
      state.ends += 1;
      await this.session?.close();
    }
  };
}

const fixture = await createReleaseBTestFixture();

try {
  const replay = await runLocalDisposableReplay({
    environment: disposableEnvironment(),
    afterMigrationLedgerValidated: async ({ executeSql, createSqlSession, canonicalMigrationCount }) => {
      assert.equal(canonicalMigrationCount, 50);
      assert.equal(typeof createSqlSession, "function", "full rehearsal requires an owned persistent disposable PostgreSQL session");
      assert.equal(process.env.LOCAL_TEST, undefined, "Production-visible LOCAL_TEST must not be required for adapter rehearsal");

      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "release-b-rehearsal-ca-test-"));
      const validCaPath = path.join(temporaryDirectory, "synthetic-test-ca.pem");
      await execFile("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(temporaryDirectory, "synthetic-test-ca.key"), "-out", validCaPath, "-days", "1", "-subj", "/CN=Release B Rehearsal Test CA"]);
      const environment = { P9_PRODUCTION_DATABASE_URL: SESSION_DSN, [TEST_CA_ENV]: validCaPath };
      const clientState = { constructed: 0, connects: 0, ends: 0, queries: [] };
      const PostgresClient = createDisposablePostgresClient({ createSqlSession, state: clientState });
      const executionSurface = await computeReleaseBExecutionSurfaceFingerprints();
      const receiptFor = (approvalId) => createReleaseBAuthorizationReceiptV4({
        approvalId,
        authorizedAtUtc: "2026-09-21T00:00:00Z",
        frozen: fixture.frozen,
        executionSurface,
      });
      const runWithReceipt = (authorizationReceipt) => runReleaseBProductionRunner({
        args: ["--execute-production"],
        environment,
        authorizationReceipt,
        authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt),
        PostgresClient,
        executeProductionImport: fixture.execute,
      });
      const assertEmpty = async () => {
        const counts = await readSchemaV1SqlVerification({ executeSql });
        assert.equal(
          counts.devices + counts.definitions + counts.specs + counts.sources + counts.sourceLinks + counts.evidence + counts.auditEvents,
          0,
          "failed runner -> adapter -> transport -> executor transaction leaves zero committed application rows",
        );
      };

      const failingReceipt = receiptFor("release-b-approval-7004");
      clientState.precheckDrift = true;
      await assert.rejects(() => runWithReceipt(failingReceipt), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/, "transaction-bound precheck drift must fail before any executor write");
      assert.equal(clientState.queries.some((sql) => sql === "ROLLBACK;"), true, "deterministic SQL failure receives an acknowledged rollback");
      assert.equal(clientState.queries.some((sql) => sql.startsWith("INSERT INTO")), false, "precheck drift blocks every executor write");
      await assertEmpty();
      await assert.rejects(() => runWithReceipt(failingReceipt), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "consumed synthetic v4 authorization rejects retry");
      assert.equal(clientState.queries.filter((sql) => sql === "ROLLBACK;").length, 1, "retry rejection does not open a second transaction or rollback");

      const successReceipt = receiptFor("release-b-approval-7005");
      const successful = await runWithReceipt(successReceipt);
      assert.equal(successful.status, "COMMITTED");
      assert.equal(JSON.parse(await readFile(successful.consumptionPath, "utf8")).status, "STARTED");
      await assert.rejects(() => runWithReceipt(successReceipt), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "committed synthetic v4 authorization rejects retry");

      const counts = await readSchemaV1SqlVerification({ executeSql });
      assert.deepEqual(
        [counts.devices, counts.definitions, counts.specs, counts.sources, counts.sourceLinks, counts.evidence, counts.auditEvents, counts.uniqueSlugs, counts.published],
        EXPECTED_COUNTS,
      );
      assert.equal(counts.constraintFailures, 0);
      assert.equal(counts.triggerFailures, 0);
      assert.equal(counts.duplicateFailures, 0);
      assert.equal(counts.conflictEvidenceFailures, 0);
      assert.equal(counts.unknownUnverifiedKnownData, 0);

      const postcheckSession = new PostgresClient({ ssl: { ca: await readFile(validCaPath, "utf8"), rejectUnauthorized: true }, password: "test-only" });
      await postcheckSession.connect();
      try {
        const postcheck = await (await import("./lib/release-b-production-postgres-adapter.mjs"))
          .createReleaseBProductionPostgresAdapter({ environment, Client: PostgresClient })
          .readPostcheck({ queryReadOnly: (sql, params) => postcheckSession.query(sql, params) });
        assert.deepEqual(
          [postcheck.counts.devices, postcheck.counts.deviceSpecDefinitions, postcheck.counts.deviceSpecs, postcheck.counts.deviceSources, postcheck.counts.deviceSourceLinks, postcheck.counts.deviceSpecEvidence, postcheck.counts.catalogAuditEvents, postcheck.uniqueSlugs, postcheck.publishedDevices],
          EXPECTED_COUNTS,
        );
        assert.equal(postcheck.conflictInvariants, "PASS");
        assert.equal(postcheck.rayBanIdentity, "ray-ban-meta");
        assert.equal(postcheck.unexpectedDeletes, 0);
      } finally {
        await postcheckSession.end();
      }

      assert.equal(environment.LOCAL_TEST, undefined);
      assert.equal(clientState.queries.some((sql) => /\bDELETE\b|\bsupabase_migrations\.schema_migrations\s*(?:\(|VALUES|SET)/i.test(sql)), false);
      assert.equal(clientState.queries.filter((sql) => sql === "COMMIT;").length, 1);
      assert.equal(clientState.queries.filter((sql) => sql === "ROLLBACK;").length, 1);

      return {
        runnerAdapterTransportExecutor: "PASS",
        counts: {
          devices: counts.devices,
          definitions: counts.definitions,
          specs: counts.specs,
          sources: counts.sources,
          sourceLinks: counts.sourceLinks,
          evidence: counts.evidence,
          auditEvents: counts.auditEvents,
          uniqueSlugs: counts.uniqueSlugs,
          published: counts.published,
        },
        retryRejected: "PASS",
        rollbackAtomicity: "PASS",
        rollbackCount: 1,
        commitCount: 1,
        localDisposablePostgres: "PASS",
        productionConnections: 0,
        localTestFlag: "ABSENT",
      };
    },
  });

  console.log(`RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_REHEARSAL_OK ${JSON.stringify(replay.afterMigrationLedgerValidated)}`);
} finally {
  await fixture.close();
}
