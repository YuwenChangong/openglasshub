import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLocalReplayTarget,
  assertSafeLocalReplayEnvironment,
  buildLocalDisposableReplayPlan,
  cleanupOwnedDisposableReplay,
  runLocalDisposableReplay,
  sanitizedChildEnvironment,
  verifyLocalMigrationLedger,
} from "./local-disposable-supabase-replay.mjs";
import { assertExplicitOwnedDisposableContainer } from "../generate-local-production-schema-fingerprint.mjs";

const root = process.cwd();

test("dry-run plans an isolated local replay without a remote target or Docker execution", () => {
  const plan = buildLocalDisposableReplayPlan({ root, runId: "ab12cd34" });
  assert.equal(plan.dryRun, true);
  assert.match(plan.projectId, /^ogl-replay-ab12cd34$/);
  assert.equal(plan.remoteConnections, 0);
  assert.deepEqual(plan.steps.map((step) => step.name), [
    "supabase-init-owned-root",
    "build-current-canonical-mirror",
    "supabase-start-owned-root",
    "validate-local-status-target",
    "validate-owned-postgres-container",
    "validate-migration-ledger",
    "fingerprint-through-owned-container-unix-socket",
    "supabase-stop-owned-root-no-backup",
    "remove-verified-owned-root",
  ]);
  assert(plan.steps.every((step) => step.command !== "docker" || step.args[0] === "exec"));
  assert(plan.steps.flatMap((step) => step.args).every((argument) => !["--linked", "--db-url", "--project-ref", "db", "push"].includes(argument)));
  assert(plan.steps.filter((step) => step.command === "npx").every((step) => step.args.includes("--workdir")));
});

test("local replay target guard rejects remote and unknown hosts", () => {
  for (const target of ["http://localhost:54321", "postgresql://127.0.0.1:54322/postgres", "http://[::1]:54321"]) {
    assert.equal(assertLocalReplayTarget(target), true);
  }
  assert.equal(assertLocalReplayTarget("http://db:5432", { ownedNetworkHosts: new Set(["db"]) }), true);
  for (const target of ["https://example.supabase.co", "postgresql://aws-0-ap-southeast-2.pooler.supabase.com/postgres", "https://database.example.test"]) {
    assert.throws(() => assertLocalReplayTarget(target), /non-local/);
  }
});

test("local replay rejects inherited database transport variables without exposing values", () => {
  for (const name of ["POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE"]) {
    assert.throws(
      () => assertSafeLocalReplayEnvironment({ [name]: "postgresql://secret@db.example.test/postgres" }),
      new RegExp(`inherited database connection variable ${name}`),
    );
  }
  assert.throws(() => assertSafeLocalReplayEnvironment({ SUPABASE_DB_URL: "postgresql://secret@db.example.test/postgres" }), /remote connection variable SUPABASE_DB_URL/);
  assert.throws(() => assertSafeLocalReplayEnvironment({ RENAMED_CONNECTION: "postgresql://secret@db.example.test/postgres" }), /remote connection variable RENAMED_CONNECTION/);
  assert.throws(() => assertSafeLocalReplayEnvironment({ SUPABASE_PROJECT_REF: "production-ref" }), /linked-project variable/);
});

test("child environment clears every inherited database transport variable", () => {
  const child = sanitizedChildEnvironment({
    PATH: process.env.PATH,
    POSTGRES_URL: "",
    DATABASE_URL: "",
    PGHOST: "",
    PGPORT: "",
    PGSERVICE: "",
    SUPABASE_DB_URL: "",
  });
  for (const name of ["POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE", "SUPABASE_DB_URL"]) assert.equal(child[name], "");
});

test("cleanup stops the owned project after a partially failed start", async () => {
  const calls = [];
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-local-disposable-supabase-ab12cd34-"));
  try {
    await cleanupOwnedDisposableReplay({
      runtimeRoot,
      repositoryRoot: root,
      startAttempted: true,
      execute: async (command, args) => { calls.push({ command, args }); return { stdout: "", stderr: "" }; },
      removeRoot: async () => {},
    });
    assert.deepEqual(calls, [{
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["--no-install", "supabase", "stop", "--no-backup", "--workdir", runtimeRoot],
    }]);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("lifecycle invokes owned-project cleanup when supabase start fails after creating state", async () => {
  const calls = [];
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args) => {
    calls.push({ command, args });
    if (command === "docker") return { stdout: "", stderr: "" };
    if (args.includes("init")) {
      const workdir = args.at(-1);
      await mkdir(path.join(workdir, "supabase"), { recursive: true });
      await writeFile(path.join(workdir, "supabase", "config.toml"), config);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("start")) throw new Error("simulated partial start failure");
    if (args.includes("stop")) return { stdout: "", stderr: "" };
    throw new Error(`unexpected command ${command}`);
  };
  await assert.rejects(
    () => runLocalDisposableReplay({ root, runId: "ab12cd34", environment: { PATH: process.env.PATH }, execute }),
    /simulated partial start failure/,
  );
  assert.equal(calls.filter(({ args }) => args.includes("start")).length, 1);
  assert.equal(calls.filter(({ args }) => args.includes("stop")).length, 1);
});

test("fingerprint transport requires the exact container created for this disposable project", () => {
  assert.equal(assertExplicitOwnedDisposableContainer({ containerId: "abc123", projectId: "ogl-replay-ab12cd34", containerName: "supabase_db_ogl-replay-ab12cd34" }), "abc123");
  assert.throws(() => assertExplicitOwnedDisposableContainer({ containerId: "abc123", projectId: "ogl-replay-ab12cd34", containerName: "supabase_db_someone-elses-project" }), /does not match/);
  assert.throws(() => assertExplicitOwnedDisposableContainer({ containerId: "", projectId: "ogl-replay-ab12cd34", containerName: "supabase_db_ogl-replay-ab12cd34" }), /explicit owned/);
});

test("migration ledger must exactly match the generated current mirror order", () => {
  const mappings = [
    { temporaryVersion: "20260518000001", temporaryFile: "20260518000001_forum_phase1_schema.sql" },
    { temporaryVersion: "20260519000001", temporaryFile: "20260519000001_forum_phase2_grants.sql" },
  ];
  assert.doesNotThrow(() => verifyLocalMigrationLedger({
    mappings,
    rows: [
      { version: "20260518000001", name: "forum_phase1_schema" },
      { version: "20260519000001", name: "forum_phase2_grants" },
    ],
  }));
  assert.throws(() => verifyLocalMigrationLedger({
    mappings,
    rows: [
      { version: "20260519000001", name: "forum_phase2_grants" },
      { version: "20260518000001", name: "forum_phase1_schema" },
    ],
  }), /order differs/);
  assert.throws(() => verifyLocalMigrationLedger({ mappings, rows: [{ version: "20260518000001", name: "forum_phase1_schema" }] }), /count differs/);
});
