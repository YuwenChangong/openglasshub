import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupExitCode, cleanupHasFailures, classificationFor } from "./qa/cleanup-preview-test-accounts.mjs";
import { QaWriteGuardError, readConfirmRunArgument, validateQaWriteTarget } from "./qa/target-write-guard.mjs";

const previewRef = "previewguard123";
const productionRef = "productionguard123";
const previewUrl = `https://${previewRef}.supabase.co`;
const productionUrl = `https://${productionRef}.supabase.co`;
const secretSentinel = "super-secret-value-must-not-print";
const emailSentinel = "ordinary@example.test";
const hookDirectory = mkdtempSync(join(tmpdir(), "openglass-qa-no-network-"));
const networkHookPath = join(hookDirectory, "block-network.cjs");

writeFileSync(
  networkHookPath,
  [
    "const fail = () => { throw new Error('QA_TEST_NETWORK_BLOCKED'); };",
    "global.fetch = fail;",
    "require('node:http').request = fail;",
    "require('node:https').request = fail;",
    "require('node:net').connect = fail;",
  ].join("\n"),
);

function expectGuardFailure(label, config, code) {
  assert.throws(
    () => validateQaWriteTarget(config),
    (error) => error instanceof QaWriteGuardError && error.code === code,
    label,
  );
}

function baseConfig(overrides = {}) {
  return {
    targetUrl: previewUrl,
    expectedTargetRef: previewRef,
    productionRef,
    allowProductionWrites: "",
    confirmRun: null,
    ...overrides,
  };
}

function childEnvironment(overrides = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(QA_|SUPABASE|PUBLIC_SUPABASE|ADMIN_BEARER)/.test(key)),
  );
  const env = {
    ...inherited,
    QA_SUPABASE_URL: previewUrl,
    QA_EXPECTED_SUPABASE_REF: previewRef,
    QA_PRODUCTION_SUPABASE_REF: productionRef,
    QA_SUPABASE_SERVICE_ROLE_KEY: secretSentinel,
    QA_ORDINARY_EMAIL: emailSentinel,
    QA_ORDINARY_PASSWORD: secretSentinel,
    QA_ADMIN_EMAIL: "admin@example.test",
    QA_ADMIN_PASSWORD: secretSentinel,
    QA_BASE_URL: "https://preview.example.pages.dev",
    NODE_OPTIONS: `${inherited.NODE_OPTIONS ?? ""} --require=${networkHookPath}`.trim(),
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete env[key];
  }
  return env;
}

function runDryScript(script, args = [], overrides = {}) {
  const result = spawnSync(process.execPath, [script, "--dry-run", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnvironment(overrides),
  });
  const output = `${result.stdout}${result.stderr}`;
  assert(!output.includes(secretSentinel), `${script} output must not expose a secret sentinel`);
  assert(!output.includes(emailSentinel), `${script} output must not expose a private email sentinel`);
  assert(!output.includes("QA_TEST_NETWORK_BLOCKED"), `${script} attempted network I/O during dry run`);
  return { ...result, output };
}

function expectDryFailure(label, script, args, overrides = {}) {
  const result = runDryScript(script, args, overrides);
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
}

function cleanSummary(overrides = {}) {
  return {
    users: [],
    auth: [],
    publicActions: { hiddenPosts: [], deletedCircles: [] },
    verification: { publicLeak: false },
    ...overrides,
  };
}

try {
  expectGuardFailure("missing target URL", baseConfig({ targetUrl: "" }), "QA_TARGET_URL_INVALID");
  expectGuardFailure("missing expected ref", baseConfig({ expectedTargetRef: "" }), "QA_EXPECTED_TARGET_REF_REQUIRED");
  expectGuardFailure("missing production ref", baseConfig({ productionRef: "" }), "QA_PRODUCTION_REF_REQUIRED");
  expectGuardFailure("mismatched refs", baseConfig({ expectedTargetRef: "differentref123" }), "QA_TARGET_REF_MISMATCH");
  expectGuardFailure(
    "unique confirmation cannot bypass mismatch",
    baseConfig({ expectedTargetRef: "differentref123", confirmRun: "qa-run-12345" }),
    "QA_TARGET_REF_MISMATCH",
  );
  expectGuardFailure("ambiguous target", baseConfig({ targetUrl: "http://localhost:54321" }), "QA_TARGET_URL_UNIDENTIFIABLE");
  expectGuardFailure("custom target", baseConfig({ targetUrl: "https://preview.example.test" }), "QA_TARGET_URL_UNIDENTIFIABLE");
  expectGuardFailure("production without opt-in", baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef }), "QA_PRODUCTION_WRITES_DISABLED");
  expectGuardFailure(
    "production with env opt-in only",
    baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, allowProductionWrites: "1" }),
    "QA_CONFIRM_RUN_INVALID",
  );
  expectGuardFailure(
    "production with confirmation only",
    baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, confirmRun: "qa-run-12345" }),
    "QA_PRODUCTION_WRITES_DISABLED",
  );
  for (const generic of ["yes", "true", "confirm", "confirmed", "production", "prod", "test", "qa", "run"]) {
    expectGuardFailure(
      `generic confirmation ${generic}`,
      baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, allowProductionWrites: "1", confirmRun: generic }),
      "QA_CONFIRM_RUN_GENERIC",
    );
  }
  assert.throws(
    () => readConfirmRunArgument(["--confirm-run", "qa-run-12345", "--confirm-run", "qa-run-67890"]),
    (error) => error instanceof QaWriteGuardError && error.code === "QA_CONFIRM_RUN_DUPLICATE",
    "duplicate confirmation flags must fail",
  );

  const productionDryRunTarget = validateQaWriteTarget(
    baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, allowProductionWrites: "1", confirmRun: "qa-run-12345" }),
  );
  assert.equal(productionDryRunTarget.productionTarget, true, "dual confirmation must validate production only in dry-run tests");
  assert.equal(validateQaWriteTarget(baseConfig()).productionTarget, false, "exact non-production ref must validate");

  const createDryRun = runDryScript("scripts/qa/create-preview-test-accounts.mjs");
  assert.equal(createDryRun.status, 0, `create dry run failed: ${createDryRun.output}`);
  assert.match(createDryRun.output, /"dryRun": true/, "create dry run must be validation-only");

  const cleanupDryRun = runDryScript("scripts/qa/cleanup-preview-test-accounts.mjs", ["--marker", "qa-run-12345"]);
  assert.equal(cleanupDryRun.status, 0, `cleanup dry run failed: ${cleanupDryRun.output}`);
  assert.match(cleanupDryRun.output, /"legacyCleanup": true/, "cleanup dry run must identify legacy cleanup");

  const confirmedProductionDryRun = runDryScript("scripts/qa/create-preview-test-accounts.mjs", ["--confirm-run", "qa-run-12345"], {
    QA_SUPABASE_URL: productionUrl,
    QA_EXPECTED_SUPABASE_REF: productionRef,
    QA_ALLOW_PRODUCTION_WRITES: "1",
  });
  assert.equal(confirmedProductionDryRun.status, 0, `confirmed fake production dry run failed: ${confirmedProductionDryRun.output}`);
  assert.match(confirmedProductionDryRun.output, /"productionTarget": true/, "confirmed production dry run must remain validation-only");

  const createScript = "scripts/qa/create-preview-test-accounts.mjs";
  expectDryFailure("missing all env", createScript, [], {
    QA_SUPABASE_URL: null, QA_EXPECTED_SUPABASE_REF: null, QA_PRODUCTION_SUPABASE_REF: null,
    QA_SUPABASE_SERVICE_ROLE_KEY: null, QA_ORDINARY_EMAIL: null, QA_ORDINARY_PASSWORD: null, QA_ADMIN_EMAIL: null, QA_ADMIN_PASSWORD: null,
  });
  expectDryFailure("target only", createScript, [], { QA_EXPECTED_SUPABASE_REF: null, QA_PRODUCTION_SUPABASE_REF: null });
  expectDryFailure("expected ref only", createScript, [], { QA_SUPABASE_URL: null, QA_PRODUCTION_SUPABASE_REF: null });
  expectDryFailure("production ref only", createScript, [], { QA_SUPABASE_URL: null, QA_EXPECTED_SUPABASE_REF: null });
  expectDryFailure("malformed target", createScript, [], { QA_SUPABASE_URL: "not-a-url" });
  expectDryFailure("target mismatch", createScript, [], { QA_EXPECTED_SUPABASE_REF: "differentref123" });
  expectDryFailure("production env only", createScript, [], { QA_SUPABASE_URL: productionUrl, QA_EXPECTED_SUPABASE_REF: productionRef });
  expectDryFailure("production confirmation only", createScript, ["--confirm-run", "qa-run-12345"], { QA_SUPABASE_URL: productionUrl, QA_EXPECTED_SUPABASE_REF: productionRef });
  for (const generic of ["yes", "true", "confirm", "confirmed", "production", "prod", "test", "qa", "run"]) {
    expectDryFailure(`generic confirmation child process ${generic}`, createScript, ["--confirm-run", generic], {
      QA_SUPABASE_URL: productionUrl,
      QA_EXPECTED_SUPABASE_REF: productionRef,
      QA_ALLOW_PRODUCTION_WRITES: "1",
    });
  }
  expectDryFailure("duplicate confirmation", createScript, ["--confirm-run", "qa-run-12345", "--confirm-run", "qa-run-67890"]);
  expectDryFailure("unrelated environment cannot bypass production guard", createScript, [], {
    QA_SUPABASE_URL: productionUrl,
    QA_EXPECTED_SUPABASE_REF: productionRef,
    PREVIEW_URL: "https://preview.example.pages.dev",
  });

  assert.equal(cleanupExitCode(cleanSummary()), 0, "clean cleanup summary should exit zero");
  const failedUser = (ownerCleanup = {}, extra = {}) => cleanSummary({
    users: [{ label: "admin", adminRoleRevoked: true, ownerCleanup, storage: { failed: 0 }, discovery: { errors: [] }, ...extra }],
  });
  for (const [label, summary] of [
    ["post", failedUser({ posts: [{ ok: false }] })],
    ["comment", failedUser({ comments: [{ ok: false }] })],
    ["circle", failedUser({ circles: [{ ok: false }] })],
    ["media", failedUser({}, { storage: { failed: 1 } })],
    ["role", failedUser({}, { adminRoleRevoked: false })],
    ["auth delete", cleanSummary({ auth: [{ authDelete: { deleted: false }, authDisable: { ok: true } }] })],
    ["residue", cleanSummary({ verification: { publicLeak: true } })],
    ["mixed categories", failedUser({ posts: [{ ok: true }], comments: [{ ok: false }] })],
  ]) {
    assert.equal(cleanupExitCode(summary), 1, `${label} cleanup failure must exit nonzero`);
  }
  const residueSummary = cleanSummary({ verification: { publicLeak: true } });
  assert.equal(cleanupHasFailures(residueSummary), true, "residue must be fatal");
  assert.equal(classificationFor(residueSummary), "NO-GO_CLEANUP_PUBLIC_LEAK", "residue must be no-go");

  console.log("QA_WRITE_GUARDS_OK no network requests or mutations performed");
} finally {
  rmSync(hookDirectory, { recursive: true, force: true });
}
