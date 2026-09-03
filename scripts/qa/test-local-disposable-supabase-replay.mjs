import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLocalReplayTarget,
  assertOwnedFingerprintEvidenceRoot,
  assertSafeLocalReplayEnvironment,
  buildLocalDisposableReplayPlan,
  cleanupOwnedDisposableReplay,
  runLocalDisposableReplay,
  sanitizedChildEnvironment,
  verifyLocalMigrationLedger,
} from "./local-disposable-supabase-replay.mjs";
import { assertExplicitOwnedDisposableContainer } from "../generate-local-production-schema-fingerprint.mjs";
import { reviewFingerprintCandidate, writeReviewedFingerprintFixture } from "../production-schema-fingerprint-review.mjs";

const root = process.cwd();

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

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

test("fingerprint evidence root is limited to the designated temporary scope", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-local-disposable-supabase-ab12cd34-"));
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-local-disposable-supabase-evidence-ab12cd34-"));
  try {
    assert.equal(assertOwnedFingerprintEvidenceRoot({ evidenceRoot, runtimeRoot, repositoryRoot: root }), evidenceRoot);
    assert.throws(
      () => assertOwnedFingerprintEvidenceRoot({ evidenceRoot: path.join(root, "fingerprint-evidence"), runtimeRoot, repositoryRoot: root }),
      /designated owned temporary directory/,
    );
    assert.throws(
      () => assertOwnedFingerprintEvidenceRoot({ evidenceRoot: runtimeRoot, runtimeRoot, repositoryRoot: root }),
      /designated owned temporary directory/,
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
  }
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

test("a stale fingerprint fixture preserves reviewable nonsecret evidence after disposable cleanup", async () => {
  const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
  const calls = [];
  let runtimeRoot;
  let candidatePath;
  let reviewPath;
  let containerListCalls = 0;
  let emitCredentialLikeEvidence = false;
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args, options = {}) => {
    calls.push({ command, args });
    if (command === "docker" && args[0] === "ps") {
      containerListCalls += 1;
      return { stdout: containerListCalls % 2 === 1 ? "" : "owned-db\tsupabase_db_ogl-replay-ab12cd34\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "exec") {
      const mirror = JSON.parse(await readFile(path.join(runtimeRoot, "mapping.json"), "utf8"));
      return {
        stdout: `version,name\n${mirror.mappings.map(({ temporaryVersion, temporaryFile }) => `${temporaryVersion},${temporaryFile.replace(/^\d+_/, "").replace(/\.sql$/, "")}`).join("\n")}\n`,
        stderr: "",
      };
    }
    if (args.includes("init")) {
      runtimeRoot = args.at(-1);
      await mkdir(path.join(runtimeRoot, "supabase"), { recursive: true });
      await writeFile(path.join(runtimeRoot, "supabase", "config.toml"), config);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("start") || args.includes("stop")) return { stdout: "", stderr: "" };
    if (args.includes("status")) return { stdout: JSON.stringify({ API_URL: "http://127.0.0.1:54321" }), stderr: "" };
    if (command === "node") {
      candidatePath = options.env.OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_CANDIDATE;
      reviewPath = options.env.OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_REVIEW;
      const candidate = {
        ...expected,
        canonicalMigrationCount: 48,
        localMigrationLedger: [
          ...expected.localMigrationLedger,
          ...Array.from({ length: 5 }, (_, index) => ({ version: `20260903${String(index + 1).padStart(6, "0")}`, name: `review_candidate_${index + 44}`, statementCount: 1 })),
        ],
      };
      if (emitCredentialLikeEvidence) candidate.diagnostic = "postgresql://user:password@database.example.test/postgres";
      const review = reviewFingerprintCandidate({ expected, candidate });
      await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
      await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
      throw new Error(`node exited 1: Fingerprint fixture review required: review id ${review.reviewId}`);
    }
    throw new Error(`unexpected command ${command}`);
  };

  try {
    await assert.rejects(
      () => runLocalDisposableReplay({ root, runId: "ab12cd34", environment: { PATH: process.env.PATH }, execute }),
      /Non-secret fingerprint evidence retained for explicit review/,
    );
    assert.equal(calls.filter(({ args }) => args.includes("stop")).length, 1, "the owned project is still stopped after a review mismatch");
    assert.equal(await exists(runtimeRoot), false, "the disposable runtime is still removed after a review mismatch");
    assert.equal(path.resolve(candidatePath).startsWith(`${path.resolve(runtimeRoot)}${path.sep}`), false, "retained candidate must be outside the cleanup root");
    assert.equal(await exists(candidatePath), true, "the candidate remains available for explicit review");
    assert.equal(await exists(reviewPath), true, "the review record remains available for explicit review");
    assert.doesNotMatch(await readFile(candidatePath, "utf8"), /postgres(?:ql)?:\/\//i, "retained candidate must not contain a database credential URL");

    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-fingerprint-fixture-update-"));
    try {
      const fixturePath = path.join(fixtureRoot, "expected.json");
      await writeFile(fixturePath, `${JSON.stringify(expected, null, 2)}\n`);
      const recordedReview = JSON.parse(await readFile(reviewPath, "utf8"));
      await writeReviewedFingerprintFixture({ fixturePath, candidatePath, reviewPath, confirmation: recordedReview.reviewId });
      assert.equal(JSON.parse(await readFile(fixturePath, "utf8")).canonicalMigrationCount, 48, "the retained review id can authorize the explicit fixture update");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }

    emitCredentialLikeEvidence = true;
    await assert.rejects(
      () => runLocalDisposableReplay({ root, runId: "ab12cd34", environment: { PATH: process.env.PATH }, execute }),
      /node exited 1: Fingerprint fixture review required/,
    );
    assert.equal(await exists(candidatePath), false, "credential-like evidence is removed instead of retained");
  } finally {
    if (candidatePath) await rm(path.dirname(candidatePath), { recursive: true, force: true });
  }
});

test("a matching fingerprint removes its separate evidence directory after cleanup", async () => {
  const calls = [];
  let runtimeRoot;
  let candidatePath;
  let containerListCalls = 0;
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args, options = {}) => {
    calls.push({ command, args });
    if (command === "docker" && args[0] === "ps") {
      containerListCalls += 1;
      return { stdout: containerListCalls === 1 ? "" : "owned-db\tsupabase_db_ogl-replay-cd34ab12\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "exec") {
      const mirror = JSON.parse(await readFile(path.join(runtimeRoot, "mapping.json"), "utf8"));
      return { stdout: `version,name\n${mirror.mappings.map(({ temporaryVersion, temporaryFile }) => `${temporaryVersion},${temporaryFile.replace(/^\d+_/, "").replace(/\.sql$/, "")}`).join("\n")}\n`, stderr: "" };
    }
    if (args.includes("init")) {
      runtimeRoot = args.at(-1);
      await mkdir(path.join(runtimeRoot, "supabase"), { recursive: true });
      await writeFile(path.join(runtimeRoot, "supabase", "config.toml"), config);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("start") || args.includes("stop")) return { stdout: "", stderr: "" };
    if (args.includes("status")) return { stdout: JSON.stringify({ API_URL: "http://127.0.0.1:54321" }), stderr: "" };
    if (command === "node") {
      candidatePath = options.env.OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_CANDIDATE;
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };

  const result = await runLocalDisposableReplay({ root, runId: "cd34ab12", environment: { PATH: process.env.PATH }, execute });
  assert.equal(result.localReplay, "PASS");
  assert.equal(calls.filter(({ args }) => args.includes("stop")).length, 1, "the owned project is stopped after a matching fingerprint");
  assert.equal(await exists(runtimeRoot), false, "the disposable runtime is removed after a matching fingerprint");
  assert.equal(await exists(path.dirname(candidatePath)), false, "matching evidence does not remain after cleanup");
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
