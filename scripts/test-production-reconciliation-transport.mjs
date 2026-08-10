import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { buildAuthorizationV4FromPackage } from "./lib/r6-production-reconciliation-authorization-v3.mjs";
import { executeWithFinalExecutionGate, finalizeHumanConfirmation, validateFinalExecutionBinding, validateOnly } from "./qa/r6-production-reconciliation-transport.mjs";

const repositoryRoot = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const hash = value => createHash("sha256").update(value).digest("hex");
const launcherSha256 = hash("offline-launcher");
const transportSha256 = hash("offline-transport");
const confirmation = "offline-transport-confirmation";
const routing = { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" };

async function buildFreshTransportFixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-transport-v4-"));
  const packageRoot = path.join(temp, "package");
  const issued = await issueProductionReconciliationV4Package({
    packageRoot, repositoryRoot, implementationCommit: commit, launcherSha256,
    secureWrapperSha256: hash("offline-secure-wrapper"), baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a",
  });
  const candidate = await buildAuthorizationV4FromPackage({ packageRoot, repositoryRoot, transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, requiredConfirmationPhrase: confirmation });
  const authorizationPath = path.join(temp, "candidate-v4.json");
  await writeFile(authorizationPath, `${JSON.stringify(candidate)}\n`, "utf8");
  return { temp, packageRoot, issued, candidate, authorizationPath };
}

const client = counters => ({
  async targetProbe() { counters.target += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: JSON.stringify({ database: "postgres", currentUser: "postgres", sessionUser: "postgres", serverVersionNum: "170006", clusterName: "main", inRecovery: false }) }; },
  async prepare() { return { outcome: "READY" }; },
  async submitMigration() { counters.mutations += 1; return { outcome: "COMMITTED" }; },
  async postflight(_bytes, { outputPath }) { await writeFile(outputPath, "offline-postflight\n"); return { outcome: "POSTFLIGHT_SUCCESS" }; },
});

const core = fixture => ({ authorizationPath: fixture.authorizationPath, packageRoot: fixture.packageRoot, implementationCommit: commit, launcherSha256, transportSha256 });
const fixtures = [];
try {
  const fixture = await buildFreshTransportFixture(); fixtures.push(fixture);
  const validation = await validateOnly(core(fixture));
  assert.equal(validation.classification, "R6_PRODUCTION_RECONCILIATION_CANDIDATE_VALIDATED_AWAITING_FINAL_HUMAN_CONFIRMATION");
  const finalPath = path.join(fixture.temp, "final-v3.json");
  await finalizeHumanConfirmation({ ...core(fixture), finalConfirmationPath: finalPath, confirmationPhrase: confirmation });
  const finalBinding = await validateFinalExecutionBinding({ ...core(fixture), finalConfirmationPath: finalPath });
  assert.equal(finalBinding.classification, "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY");

  const happyCounters = { target: 0, mutations: 0 }; const happyFactory = { count: 0 };
  const happyEvidenceRoot = path.join(fixture.temp, "happy-evidence");
  const happy = await executeWithFinalExecutionGate({ ...core(fixture), finalConfirmationPath: finalPath, receiptRoot: path.join(fixture.temp, "receipts"), evidenceRoot: happyEvidenceRoot, environment: routing, clientFactory: () => { happyFactory.count += 1; return client(happyCounters); } });
  assert.equal(happyFactory.count, 1); assert.equal(happyCounters.target, 1); assert.equal(happyCounters.mutations, 1);
  assert.equal(happy.classification, "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE");
  for (const name of ["expected-runtime-routing.json", "observed-runtime-routing.json", "runtime-routing-validation.json", "production-reconciliation-execution-terminal.json"]) await readFile(path.join(happyEvidenceRoot, name));

  for (const pgUser of ["postgres.aaaaaaaaaaaaaaaaaaaa", undefined, "", "postgres", "postgres.", "postgres..xcbnxzjlsvtgzixurcof", "postgres.xcbnxzjlsvtgzixurcof.extra"]) {
    const negative = await buildFreshTransportFixture(); fixtures.push(negative);
    const negativeFinal = path.join(negative.temp, "final-v3.json");
    await finalizeHumanConfirmation({ ...core(negative), finalConfirmationPath: negativeFinal, confirmationPhrase: confirmation });
    const calls = { count: 0 }; const counters = { target: 0, mutations: 0 };
    const result = await executeWithFinalExecutionGate({ ...core(negative), finalConfirmationPath: negativeFinal, receiptRoot: path.join(negative.temp, "receipts"), environment: { ...routing, PGUSER: pgUser }, clientFactory: () => { calls.count += 1; return client(counters); } });
    assert.equal(result.classification, pgUser === "postgres.aaaaaaaaaaaaaaaaaaaa" ? "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PROJECT_REF_MISMATCH" : "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_IDENTITY_INVALID");
    assert.equal(calls.count, 0); assert.equal(counters.target, 0); assert.equal(counters.mutations, 0); assert.equal(result.executionAttemptConsumed, false);
    await readFile(path.join(result.evidenceRoot, "runtime-routing-validation.json"));
  }

  const stale = path.join(fixture.temp, "candidate-v3.json");
  await writeFile(stale, '{"schemaVersion":"qa-production-reconciliation-execution-authorization-v2"}\n', "utf8");
  await assert.rejects(validateOnly({ ...core(fixture), authorizationPath: stale }), /AUTHORIZATION_V4_INVALID/);
  console.log("R6_PRODUCTION_RECONCILIATION_TRANSPORT_V4_FAKE_HARNESS_READY");
} finally {
  await Promise.all(fixtures.map(fixture => rm(fixture.temp, { recursive: true, force: true })));
}
