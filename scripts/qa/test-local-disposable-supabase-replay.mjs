import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertLocalReplayTarget,
  assertSafeLocalReplayEnvironment,
  buildLocalDisposableReplayPlan,
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

test("local replay rejects inherited remote DSNs and linked-project options", () => {
  assert.doesNotThrow(() => assertSafeLocalReplayEnvironment({ DATABASE_URL: "postgresql://postgres@localhost/postgres" }));
  assert.throws(() => assertSafeLocalReplayEnvironment({ DATABASE_URL: "postgresql://postgres@db.example.test/postgres" }), /remote connection variable/);
  assert.throws(() => assertSafeLocalReplayEnvironment({ SUPABASE_PROJECT_REF: "production-ref" }), /linked-project variable/);
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
