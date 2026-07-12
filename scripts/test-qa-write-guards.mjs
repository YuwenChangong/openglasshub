import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cleanupHasFailures, classificationFor } from "./qa/cleanup-preview-test-accounts.mjs";
import { QaWriteGuardError, validateQaWriteTarget } from "./qa/target-write-guard.mjs";

const previewRef = "previewguard123";
const productionRef = "productionguard123";
const previewUrl = `https://${previewRef}.supabase.co`;
const productionUrl = `https://${productionRef}.supabase.co`;
const secretSentinel = "super-secret-value-must-not-print";

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

function runDryScript(script, args, overrides = {}) {
  const result = spawnSync(process.execPath, [script, "--dry-run", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      QA_SUPABASE_URL: previewUrl,
      QA_EXPECTED_SUPABASE_REF: previewRef,
      QA_PRODUCTION_SUPABASE_REF: productionRef,
      QA_SUPABASE_SERVICE_ROLE_KEY: secretSentinel,
      QA_ORDINARY_EMAIL: "ordinary@example.test",
      QA_ORDINARY_PASSWORD: secretSentinel,
      QA_ADMIN_EMAIL: "admin@example.test",
      QA_ADMIN_PASSWORD: secretSentinel,
      QA_BASE_URL: "https://preview.example.pages.dev",
      ...overrides,
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert(!output.includes(secretSentinel), `${script} output must not expose a secret sentinel`);
  return { ...result, output };
}

expectGuardFailure("missing target URL", baseConfig({ targetUrl: "" }), "QA_TARGET_URL_INVALID");
expectGuardFailure("missing expected ref", baseConfig({ expectedTargetRef: "" }), "QA_EXPECTED_TARGET_REF_REQUIRED");
expectGuardFailure("mismatched refs", baseConfig({ expectedTargetRef: "differentref123" }), "QA_TARGET_REF_MISMATCH");
expectGuardFailure("ambiguous target", baseConfig({ targetUrl: "http://localhost:54321" }), "QA_TARGET_URL_UNIDENTIFIABLE");
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
expectGuardFailure(
  "generic confirmation",
  baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, allowProductionWrites: "1", confirmRun: "confirm" }),
  "QA_CONFIRM_RUN_GENERIC",
);

const productionDryRunTarget = validateQaWriteTarget(
  baseConfig({ targetUrl: productionUrl, expectedTargetRef: productionRef, allowProductionWrites: "1", confirmRun: "qa-run-12345" }),
);
assert.equal(productionDryRunTarget.productionTarget, true, "dual confirmation must validate production only in dry-run tests");
assert.equal(validateQaWriteTarget(baseConfig()).productionTarget, false, "exact non-production ref must validate");

const createDryRun = runDryScript("scripts/qa/create-preview-test-accounts.mjs", []);
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

const cleanSummary = { users: [], auth: [], publicActions: { hiddenPosts: [], deletedCircles: [] }, verification: { publicLeak: false } };
assert.equal(cleanupHasFailures(cleanSummary), false, "empty completed cleanup summary should pass");
assert.equal(
  cleanupHasFailures({ ...cleanSummary, users: [{ label: "admin", adminRoleRevoked: true, ownerCleanup: { posts: [{ ok: false }] }, storage: { failed: 0 }, discovery: { errors: [] } }] }),
  true,
  "a failed cleanup category must be fatal",
);
assert.equal(
  classificationFor({ ...cleanSummary, verification: { publicLeak: true } }),
  "NO-GO_CLEANUP_PUBLIC_LEAK",
  "public residue must be no-go",
);

console.log("QA_WRITE_GUARDS_OK no network requests or mutations performed");
