import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLocalReplayTarget,
  assertFailureReceiptSchema,
  classifySupabaseStartFailure,
  assertOwnedFingerprintEvidenceRoot,
  assertSafeLocalReplayEnvironment,
  buildLocalDisposableReplayPlan,
  cleanupOwnedDisposableReplay,
  runLocalDisposableReplay,
  runCommand,
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
  let receiptPath;
  await assert.rejects(() => runLocalDisposableReplay({ root, runId: "ab12cd34", environment: { PATH: process.env.PATH }, execute }), (error) => {
    receiptPath = error.message.match(/receipt: (.+)$/m)?.[1];
    return /Non-secret replay failure receipt retained/.test(error.message) && Boolean(receiptPath);
  });
  assert.equal(calls.filter(({ args }) => args.includes("start")).length, 1);
  assert.equal(calls.filter(({ args }) => args.includes("stop")).length, 1);
  await rm(path.dirname(receiptPath), { recursive: true, force: true });
});

test("runtime failures retain a strict nonsecret receipt after cleanup", async () => {
  const calls = [];
  let runtimeRoot;
  const secret = "postgresql://runner:do-not-retain@database.example.test/postgres";
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args) => {
    calls.push({ command, args });
    if (command === "docker") return { stdout: "", stderr: "" };
    if (args.includes("init")) {
      runtimeRoot = args.at(-1);
      await mkdir(path.join(runtimeRoot, "supabase"), { recursive: true });
      await writeFile(path.join(runtimeRoot, "supabase", "config.toml"), config);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("start")) {
      const failure = new Error(`simulated start failure: ${secret}`);
      failure.code = secret;
      failure.exitCode = 17;
      throw failure;
    }
    if (args.includes("stop")) return { stdout: "", stderr: "" };
    throw new Error(`unexpected command ${command}`);
  };

  let receiptPath;
  await assert.rejects(
    () => runLocalDisposableReplay({ root, runId: "f1a2b3c4", environment: { PATH: process.env.PATH }, execute }),
    (error) => {
      assert.match(error.message, /Non-secret replay failure receipt retained/);
      assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\//i);
      receiptPath = error.message.match(/receipt: (.+)$/m)?.[1];
      return Boolean(receiptPath);
    },
  );
  assert.equal(calls.filter(({ args }) => args.includes("stop")).length, 1, "cleanup still stops the owned project");
  assert.equal(await exists(runtimeRoot), false, "cleanup removes the disposable runtime before retaining evidence");
  assert.deepEqual(await readdir(path.dirname(receiptPath)), ["failure-receipt.json"], "runtime failure evidence contains only the receipt");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(Object.keys(receipt).sort(), ["class", "cleanupStatus", "code", "exitCode", "format", "runId", "stage", "startDiagnostic"]);
  assert.deepEqual(receipt, {
    format: "openglass-local-disposable-supabase-failure-receipt-v1",
    runId: "f1a2b3c4",
    stage: "supabase-start-owned-root",
    class: "command-exit",
    exitCode: 17,
    code: null,
    startDiagnostic: "UNKNOWN",
    cleanupStatus: "completed",
  });
  assert.doesNotMatch(JSON.stringify(receipt), /postgres(?:ql)?:\/\/|runner|do-not-retain|database\.example/i);
  await rm(path.dirname(receiptPath), { recursive: true, force: true });
});

test("failure receipts diagnose status, owned-container, and migration-ledger failures", async () => {
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const cases = [
    { runId: "a1a2a3a4", trigger: "status", stage: "validate-local-status-target", failureClass: "status-invalid" },
    { runId: "b1b2b3b4", trigger: "container", stage: "validate-owned-postgres-container", failureClass: "owned-container-invalid" },
    { runId: "c1c2c3c4", trigger: "ledger", stage: "validate-migration-ledger", failureClass: "migration-ledger-invalid" },
  ];
  for (const scenario of cases) {
    let runtimeRoot;
    let containerListCalls = 0;
    const execute = async (command, args) => {
      if (command === "docker" && args[0] === "ps") {
        containerListCalls += 1;
        const ownedName = `supabase_db_ogl-replay-${scenario.runId}`;
        return { stdout: containerListCalls === 1 || scenario.trigger === "container" ? "" : `owned-db\t${ownedName}\n`, stderr: "" };
      }
      if (command === "docker" && args[0] === "exec") return { stdout: "version,name\n", stderr: "" };
      if (args.includes("init")) {
        runtimeRoot = args.at(-1);
        await mkdir(path.join(runtimeRoot, "supabase"), { recursive: true });
        await writeFile(path.join(runtimeRoot, "supabase", "config.toml"), config);
        return { stdout: "", stderr: "" };
      }
      if (args.includes("start") || args.includes("stop")) return { stdout: "", stderr: "" };
      if (args.includes("status")) return { stdout: scenario.trigger === "status" ? "not-json" : JSON.stringify({ API_URL: "http://127.0.0.1:54321" }), stderr: "" };
      throw new Error(`unexpected command ${command}`);
    };
    let receiptPath;
    await assert.rejects(
      () => runLocalDisposableReplay({ root, runId: scenario.runId, environment: { PATH: process.env.PATH }, execute }),
      (error) => {
        receiptPath = error.message.match(/receipt: (.+)$/m)?.[1];
        return /Non-secret replay failure receipt retained/.test(error.message) && Boolean(receiptPath);
      },
    );
    assert.equal(await exists(runtimeRoot), false, `${scenario.trigger} failure still removes the runtime root`);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.stage, scenario.stage);
    assert.equal(receipt.class, scenario.failureClass);
    assert.equal(receipt.code, "UNSPECIFIED");
    assert.equal(receipt.exitCode, null);
    assert.equal(receipt.startDiagnostic, "NOT_APPLICABLE");
    assert.equal(receipt.cleanupStatus, "completed");
    await rm(path.dirname(receiptPath), { recursive: true, force: true });
  }
});

test("start failure classifier reduces transient command output to a closed diagnostic enum", () => {
  const secretBearingOutput = "postgresql://diagnostic-user:local-only-value@database.example.test/postgres";
  const cases = [
    [{ stdout: "could not parse generated config.toml", stderr: "" }, "CONFIG_INVALID"],
    [{ stdout: "", stderr: "bind: address already in use" }, "PORT_CONFLICT"],
    [{ stdout: "", stderr: "Cannot connect to the Docker daemon" }, "DOCKER_UNAVAILABLE"],
    [{ stdout: "service analytics is unhealthy after timeout", stderr: "" }, "SERVICE_HEALTH_FAILED"],
    [{ stdout: "", stderr: "vector host network is unreachable" }, "VECTOR_HOST_NETWORK_UNREACHABLE"],
    [{ stdout: secretBearingOutput, stderr: "opaque startup failure" }, "UNKNOWN"],
  ];
  for (const [output, diagnostic] of cases) assert.equal(classifySupabaseStartFailure(output), diagnostic);
  assert.deepEqual(
    { startDiagnostic: classifySupabaseStartFailure({ stdout: secretBearingOutput, stderr: "opaque startup failure" }) },
    { startDiagnostic: "UNKNOWN" },
    "the classified result contains no captured command output",
  );
});

test("streaming start inspection retains only an enum when the command exits nonzero", async () => {
  const secretBearingOutput = "postgresql://diagnostic-user:local-only-value@database.example.test/postgres";
  const childProgram = `process.stderr.write(${JSON.stringify(`vector host network is unreachable: ${secretBearingOutput}`)}); process.exit(9);`;
  await assert.rejects(
    () => runCommand(process.execPath, ["-e", childProgram], { inspectSupabaseStartFailure: true }),
    (error) => {
      assert.equal(error.exitCode, 9);
      assert.equal(error.startDiagnostic, "VECTOR_HOST_NETWORK_UNREACHABLE");
      assert.deepEqual(Object.keys(error).sort(), ["exitCode", "startDiagnostic"]);
      assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\//i);
      assert.doesNotMatch(JSON.stringify(error), /postgres(?:ql)?:\/\//i);
      return true;
    },
  );
});

test("failure receipt schema accepts only classified start diagnostics and no raw output fields", () => {
  const valid = {
    format: "openglass-local-disposable-supabase-failure-receipt-v1",
    runId: "a1b2c3d4",
    stage: "validate-local-status-target",
    class: "status-invalid",
    exitCode: null,
    code: "UNSPECIFIED",
    startDiagnostic: "NOT_APPLICABLE",
    cleanupStatus: "completed",
  };
  assert.equal(assertFailureReceiptSchema(valid), true);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, stderr: "must never be retained" }), /unknown or missing field/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, stdout: "must never be retained" }), /unknown or missing field/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, code: "postgresql://role:password@db.example.test/postgres" }), /exactly one sanitized failure code/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, exitCode: 1 }), /exactly one sanitized failure code/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, stage: "docker://container/user" }), /invalid stage/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, startDiagnostic: "UNKNOWN" }), /invalid start diagnostic/);
  assert.throws(() => assertFailureReceiptSchema({ ...valid, startDiagnostic: "postgresql://diagnostic-user:local-only-value@database.example.test/postgres" }), /invalid start diagnostic/);
  assert.equal(assertFailureReceiptSchema({
    ...valid,
    stage: "supabase-start-owned-root",
    class: "command-exit",
    exitCode: 7,
    code: null,
    startDiagnostic: "UNKNOWN",
  }), true);
});

test("a receipt records failed cleanup without retaining cleanup output", async () => {
  let runtimeRoot;
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args) => {
    if (command === "docker") return { stdout: "", stderr: "" };
    if (args.includes("init")) {
      runtimeRoot = args.at(-1);
      await mkdir(path.join(runtimeRoot, "supabase"), { recursive: true });
      await writeFile(path.join(runtimeRoot, "supabase", "config.toml"), config);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("start")) {
      const failure = new Error("start failed");
      failure.exitCode = 9;
      throw failure;
    }
    if (args.includes("stop")) throw new Error("cleanup output with postgresql://role:password@db.example.test/postgres");
    throw new Error(`unexpected command ${command}`);
  };
  let receiptPath;
  await assert.rejects(
    () => runLocalDisposableReplay({ root, runId: "d1d2d3d4", environment: { PATH: process.env.PATH }, execute }),
    (error) => {
      receiptPath = error.message.match(/receipt: (.+)$/m)?.[1];
      return /Non-secret replay failure receipt retained/.test(error.message) && !/postgres(?:ql)?:\/\//i.test(error.message);
    },
  );
  assert.equal(await exists(runtimeRoot), false, "cleanup removes the runtime even when stop reports failure");
  const receiptText = await readFile(receiptPath, "utf8");
  assert.match(receiptText, /"cleanupStatus": "failed"/);
  assert.doesNotMatch(receiptText, /postgres(?:ql)?:\/\/|role|password/i);
  await rm(path.dirname(receiptPath), { recursive: true, force: true });
});

test("matching fingerprint evidence is removed when cleanup fails", async () => {
  const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
  let runtimeRoot;
  let receiptPath;
  let containerListCalls = 0;
  const config = `project_id = "test"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 54383\n`;
  const execute = async (command, args, options = {}) => {
    if (command === "docker" && args[0] === "ps") {
      containerListCalls += 1;
      return { stdout: containerListCalls === 1 ? "" : "owned-db\tsupabase_db_ogl-replay-e1e2e3e4\n", stderr: "" };
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
    if (args.includes("start")) return { stdout: "", stderr: "" };
    if (args.includes("status")) return { stdout: JSON.stringify({ API_URL: "http://127.0.0.1:54321" }), stderr: "" };
    if (command === "node") {
      await writeFile(options.env.OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_CANDIDATE, `${JSON.stringify(expected, null, 2)}\n`);
      await writeFile(options.env.OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_REVIEW, `${JSON.stringify(reviewFingerprintCandidate({ expected, candidate: expected }), null, 2)}\n`);
      return { stdout: "", stderr: "" };
    }
    if (args.includes("stop")) throw new Error("cleanup output with postgresql://role:password@db.example.test/postgres");
    throw new Error(`unexpected command ${command}`);
  };

  try {
    await assert.rejects(
      () => runLocalDisposableReplay({ root, runId: "e1e2e3e4", environment: { PATH: process.env.PATH }, execute }),
      (error) => {
        receiptPath = error.message.match(/receipt: (.+)$/m)?.[1];
        return /Non-secret replay failure receipt retained/.test(error.message) && !/postgres(?:ql)?:\/\//i.test(error.message) && Boolean(receiptPath);
      },
    );
    assert.equal(await exists(runtimeRoot), false, "the disposable runtime is removed when cleanup reports a failure");
    assert.deepEqual(await readdir(path.dirname(receiptPath)), ["failure-receipt.json"], "matching candidate and review are not retained after cleanup failure");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.deepEqual(receipt, {
      format: "openglass-local-disposable-supabase-failure-receipt-v1",
      runId: "e1e2e3e4",
      stage: "cleanup-owned-root",
      class: "cleanup-failed",
      exitCode: null,
      code: "UNSPECIFIED",
      startDiagnostic: "NOT_APPLICABLE",
      cleanupStatus: "failed",
    });
    assert.doesNotMatch(JSON.stringify(receipt), /postgres(?:ql)?:\/\/|role|password/i);
  } finally {
    if (receiptPath) await rm(path.dirname(receiptPath), { recursive: true, force: true });
  }
});

test("evidence-root creation failure still removes the already-owned runtime root", async () => {
  let runtimeRoot;
  const execute = async (_command, args) => {
    runtimeRoot = args.at(-1);
    throw new Error("the replay must not begin when evidence-root creation fails");
  };
  await assert.rejects(
    () => runLocalDisposableReplay({
      root,
      runId: "ef12ab34",
      environment: { PATH: process.env.PATH },
      execute,
      createFingerprintEvidence: async () => { throw new Error("simulated evidence-root creation failure"); },
    }),
    /simulated evidence-root creation failure/,
  );
  assert.equal(runtimeRoot, undefined, "no replay command may run after evidence-root creation fails");
  const roots = (await readdir(os.tmpdir()))
    .filter((name) => name.startsWith("openglass-local-disposable-supabase-ef12ab34-"));
  assert.deepEqual(roots, [], "the already-created owned runtime root is removed");
});

test("a stale fingerprint fixture preserves reviewable nonsecret evidence after disposable cleanup", async () => {
  const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
  const calls = [];
  let runtimeRoot;
  let candidatePath;
  let reviewPath;
  let containerListCalls = 0;
  let emitCredentialLikeEvidence = false;
  let emitUnknownSensitiveEvidence = false;
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
      if (emitUnknownSensitiveEvidence) candidate.handoff = { authorization: "redacted-sensitive-value" };
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
      /Fingerprint candidate failed and its evidence was rejected/,
    );
    assert.equal(await exists(candidatePath), false, "credential-like evidence is removed instead of retained");

    emitCredentialLikeEvidence = false;
    emitUnknownSensitiveEvidence = true;
    await assert.rejects(
      () => runLocalDisposableReplay({ root, runId: "ab12cd34", environment: { PATH: process.env.PATH }, execute }),
      (error) => {
        assert.match(error.message, /Fingerprint candidate failed and its evidence was rejected/);
        assert.doesNotMatch(error.message, /redacted-sensitive-value|authorization/i, "rejected evidence values and keys are never printed");
        return true;
      },
    );
    assert.equal(await exists(candidatePath), false, "unknown sensitive evidence is removed instead of retained");
    assert.equal(await exists(reviewPath), false, "the paired review is removed with rejected evidence");
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
