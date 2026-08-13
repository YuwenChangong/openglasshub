import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadExecutionMaterializationV2 } from "./lib/r6-production-reconciliation-materialization-v2.mjs";
import { prepareFinalExecutionFromExecuteApprovalV2 } from "./qa/r6-production-reconciliation-transport.mjs";
import { loadExternalExecutionMaterializationReadyV1, prepareExternalExecutionMaterializationV1 } from "./qa/r6-production-reconciliation-external-materialization-v1.mjs";
import { createLocalR6ProductionReconciliationAuthorityFixture } from "./test-support/r6-production-reconciliation-local-authority-fixture.mjs";

const root = process.cwd();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const expectedProjectRef = "xcbnxzjlsvtgzixurcof";
const fakePassword = "R6_TEST_ONLY_FAKE_" + "PASSWORD_SENTINEL";
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "offline", help: "offline" };
const routing = { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: `postgres.${expectedProjectRef}` };
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-external-materialization-"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

function fakeTransportSource({ resultPath, transportSha256 }) {
  const transportUrl = pathToFileURL(path.join(root, "scripts", "qa", "r6-production-reconciliation-transport.mjs")).href;
  return `import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { executeWithFinalExecutionGate } from ${JSON.stringify(transportUrl)};
const [mode, approvalPath, packageRoot, finalConfirmationPath, receiptRoot, candidateRoot, executionBindingPath, materializationPath, launcherBindingPath, evidenceRoot] = process.argv.slice(2);
if (!["Execute", "Preflight"].includes(mode)) throw Object.assign(new Error("FAKE_TRANSPORT_INPUT_INVALID"), { code: "FAKE_TRANSPORT_INPUT_INVALID" });
if (mode === "Preflight") { process.stdout.write(JSON.stringify({ classification: "R6_PRODUCTION_RECONCILIATION_OFFLINE_PREFLIGHT_READY" }) + "\\n"); process.exit(0); }
let factoryCalls = 0;
const result = await executeWithFinalExecutionGate({
  approvalPath, repositoryRoot: ${JSON.stringify(root)}, packageRoot, candidateRoot, finalConfirmationPath,
  executionBindingPath, receiptRoot, evidenceRoot, transportSha256: ${JSON.stringify(transportSha256)},
  environment: process.env, sqlClientCapability: ${JSON.stringify(capability)},
  clientFactory: () => {
    factoryCalls += 1;
    return {
      async targetProbe() { return { outcome: "TARGET_FAILURE" }; },
      async submitMigration() { throw new Error("FAKE_SQL_SUBMISSION_MUST_NOT_RUN"); },
      async postflight() { throw new Error("FAKE_POSTFLIGHT_MUST_NOT_RUN"); },
    };
  },
});
await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ classification: result.classification, fakeSqlClientFactoryEntered: factoryCalls === 1, childSecretVisible: createHash("sha256").update(process.env.PGPASSWORD ?? "").digest("hex") === ${JSON.stringify(hash(fakePassword))}, productionConnectionAttempted: false, sqlSubmitted: result.executionAttemptConsumed === true, productionMutationSubmissions: 0 }) + "\\n");
`;
}

async function makeReady(label) {
  const authorityRoot = path.join(parent, `${label}-authority`);
  const externalRoot = path.join(parent, `${label}-external`);
  const fixture = await createLocalR6ProductionReconciliationAuthorityFixture({ tempRoot: authorityRoot, repositoryRoot: root, sourceCommit });
  const resultPath = path.join(authorityRoot, "fake-transport-result.json");
  const transportPath = path.join(authorityRoot, "fake-transport.mjs");
  await writeFile(transportPath, fakeTransportSource({ resultPath, transportSha256: fixture.transportSha256 }));
  const issued = await prepareExternalExecutionMaterializationV1({
    repositoryRoot: root, externalRoot, ...fixture, transportPath, nodePath: process.execPath,
    receiptRoot: path.join(authorityRoot, "receipts"), evidenceRoot: path.join(authorityRoot, "execution-evidence"),
    materializationEvidenceRoot: path.join(authorityRoot, "materialization-authority-evidence"),
  });
  const ready = await loadExternalExecutionMaterializationReadyV1({ externalRoot, readyInventoryPath: issued.readyPath });
  return { authorityRoot, externalRoot, fixture, resultPath, transportPath, issued, ready };
}

async function writeReady(rootCase, patch) {
  const value = JSON.parse(await readFile(rootCase.issued.readyPath, "utf8"));
  await writeFile(rootCase.issued.readyPath, `${JSON.stringify(patch(value))}\n`);
}

async function expectReadyReject(rootCase, patch, pattern) {
  if (patch) await patch(rootCase);
  await assert.rejects(() => loadExternalExecutionMaterializationReadyV1({ externalRoot: rootCase.externalRoot, readyInventoryPath: rootCase.issued.readyPath }), pattern);
  await assert.rejects(readFile(rootCase.resultPath), /ENOENT/);
}

async function invokeGeneratedWrapper(rootCase, environment) {
  const codePoints = [...fakePassword].map(char => char.charCodeAt(0)).join(",");
  const materializedBrokerPath = path.join(rootCase.externalRoot, "r6-production-dpapi-credential-broker.ps1");
  await writeFile(materializedBrokerPath, `function Get-R6ProductionPgPasswordSecureString { $s = New-Object Security.SecureString; [char[]](${codePoints}) | ForEach-Object { $s.AppendChar($_) }; $s.MakeReadOnly(); return $s }\n`);
  const brokerSha256 = hash(await readFile(materializedBrokerPath));
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", rootCase.ready.paths.wrapper, "-LauncherPath", rootCase.ready.paths.launcher, "-ExpectedLauncherSha256", rootCase.ready.value.renderedLauncherObservedSha256, "-ExpectedCredentialBrokerSha256", brokerSha256], {
    cwd: root, env: { ...process.env, ...environment }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  const valid = await makeReady("valid");
  const output = await invokeGeneratedWrapper(valid, routing);
  const validResult = JSON.parse(await readFile(valid.resultPath, "utf8"));
  assert.equal(validResult.classification, "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED");
  assert.equal(validResult.fakeSqlClientFactoryEntered, true);
  assert.equal(validResult.childSecretVisible, true);
  assert.equal(validResult.productionConnectionAttempted, false);
  assert.equal(validResult.sqlSubmitted, false);
  assert.equal(validResult.productionMutationSubmissions, 0);
  assert.doesNotMatch(output, new RegExp(fakePassword));
  for (const file of [valid.issued.wrapperPath, valid.issued.materializationPath, valid.issued.bindingPath, valid.issued.launcherPath, valid.issued.readyPath]) assert.doesNotMatch(await readFile(file, "utf8"), new RegExp(fakePassword));

  const wrongUser = await makeReady("wrong-user");
  await invokeGeneratedWrapper(wrongUser, { ...routing, PGUSER: "postgres.aaaaaaaaaaaaaaaaaaaa" });
  const wrongResult = JSON.parse(await readFile(wrongUser.resultPath, "utf8"));
  assert.equal(wrongResult.classification, "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PROJECT_REF_MISMATCH");
  assert.equal(wrongResult.fakeSqlClientFactoryEntered, false);
  assert.equal(wrongResult.sqlSubmitted, false);

  for (const [label, patch] of [
    ["parent-escape", async value => writeReady(value, ready => ({ ...ready, materializationRelativePath: "../escaped.json" }))],
    ["absolute-path", async value => writeReady(value, ready => ({ ...ready, launcherBindingRelativePath: path.join(parent, "outside.json") }))],
    ["other-root", async value => writeReady(value, ready => ({ ...ready, renderedLauncherRelativePath: path.relative(value.externalRoot, path.join(parent, "other-root", "launcher.ps1")) }))],
    ["historical-proof", async value => writeReady(value, ready => ({ ...ready, secureWrapperRelativePath: "C:\\Users\\1\\OpenGlassHub-R6-Proof\\start-r6-production-reconciliation-secure-session.ps1" }))],
  ]) {
    const caseRoot = await makeReady(label);
    await expectReadyReject(caseRoot, patch, /EXTERNAL_READY_PATH_INVALID/);
  }

  const sourceCommitMismatch = await makeReady("source-commit-mismatch");
  await writeReady(sourceCommitMismatch, ready => ({ ...ready, sourceCommit: "a".repeat(40) }));
  await expectReadyReject(sourceCommitMismatch, null, /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);

  const materializationSourceMismatch = await makeReady("materialization-source-mismatch");
  const materializationSourceBytes = Buffer.from(`${JSON.stringify({ ...JSON.parse(await readFile(materializationSourceMismatch.issued.materializationPath, "utf8")), sourceCommit: "a".repeat(40) })}\n`);
  await writeFile(materializationSourceMismatch.issued.materializationPath, materializationSourceBytes);
  await writeReady(materializationSourceMismatch, ready => ({ ...ready, materializationSha256: hash(materializationSourceBytes) }));
  await expectReadyReject(materializationSourceMismatch, null, /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);

  const bindingSourceMismatch = await makeReady("binding-source-mismatch");
  const bindingSourceBytes = Buffer.from(`${JSON.stringify({ ...JSON.parse(await readFile(bindingSourceMismatch.issued.bindingPath, "utf8")), sourceCommit: "a".repeat(40) })}\n`);
  await writeFile(bindingSourceMismatch.issued.bindingPath, bindingSourceBytes);
  await writeReady(bindingSourceMismatch, ready => ({ ...ready, launcherBindingSha256: hash(bindingSourceBytes) }));
  await expectReadyReject(bindingSourceMismatch, null, /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);

  const readyAndBindingSourceMismatch = await makeReady("ready-and-binding-source-mismatch");
  const readyAndBindingBytes = Buffer.from(`${JSON.stringify({ ...JSON.parse(await readFile(readyAndBindingSourceMismatch.issued.bindingPath, "utf8")), sourceCommit: "a".repeat(40) })}\n`);
  await writeFile(readyAndBindingSourceMismatch.issued.bindingPath, readyAndBindingBytes);
  await writeReady(readyAndBindingSourceMismatch, ready => ({ ...ready, sourceCommit: "a".repeat(40), launcherBindingSha256: hash(readyAndBindingBytes) }));
  await expectReadyReject(readyAndBindingSourceMismatch, null, /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);

  const readyAndMaterializationSourceMismatch = await makeReady("ready-and-materialization-source-mismatch");
  const readyAndMaterializationBytes = Buffer.from(`${JSON.stringify({ ...JSON.parse(await readFile(readyAndMaterializationSourceMismatch.issued.materializationPath, "utf8")), sourceCommit: "a".repeat(40) })}\n`);
  await writeFile(readyAndMaterializationSourceMismatch.issued.materializationPath, readyAndMaterializationBytes);
  await writeReady(readyAndMaterializationSourceMismatch, ready => ({ ...ready, sourceCommit: "a".repeat(40), materializationSha256: hash(readyAndMaterializationBytes) }));
  await expectReadyReject(readyAndMaterializationSourceMismatch, null, /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);

  for (const [label, patch] of [
    ["materialization", async value => writeFile(value.issued.materializationPath, "{}\n")],
    ["binding", async value => writeFile(value.issued.bindingPath, "{}\n")],
    ["launcher", async value => writeFile(value.issued.launcherPath, "tampered launcher\n")],
    ["inventory", async value => writeReady(value, ready => ({ ...ready, launcherBindingSha256: "0".repeat(64) }))],
    ["wrapper", async value => writeFile(value.issued.wrapperPath, "tampered wrapper\n")],
  ]) {
    const caseRoot = await makeReady(`tamper-${label}`);
    await expectReadyReject(caseRoot, patch, /EXTERNAL_READY_(BINDING_FAILED|ARTIFACT_INVALID|LAUNCHER_INVALID)/);
  }

  const lineageA = await makeReady("lineage-a");
  const lineageB = await makeReady("lineage-b");
  const bindingB = await readFile(lineageB.issued.bindingPath);
  await writeFile(lineageA.issued.bindingPath, bindingB);
  await writeReady(lineageA, ready => ({ ...ready, launcherBindingSha256: hash(bindingB) }));
  await expectReadyReject(lineageA, null, /EXTERNAL_READY_LINEAGE_INVALID/);

  const launcherA = await makeReady("launcher-a");
  const launcherB = await makeReady("launcher-b");
  const launcherBBytes = await readFile(launcherB.issued.launcherPath);
  await writeFile(launcherA.issued.launcherPath, launcherBBytes);
  await writeReady(launcherA, ready => ({ ...ready, renderedLauncherObservedSha256: hash(launcherBBytes) }));
  await expectReadyReject(launcherA, null, /EXTERNAL_READY_LINEAGE_INVALID/);

  const finalA = await makeReady("final-a");
  const finalBRoot = path.join(parent, "final-b-authority");
  const finalB = await createLocalR6ProductionReconciliationAuthorityFixture({ tempRoot: finalBRoot, repositoryRoot: root, sourceCommit });
  const preparedB = await prepareFinalExecutionFromExecuteApprovalV2({
    repositoryRoot: root, ...finalB, receiptRoot: path.join(finalBRoot, "receipts"), evidenceRoot: path.join(finalBRoot, "evidence"),
  });
  await assert.rejects(() => loadExecutionMaterializationV2({
    repositoryRoot: root, ...finalA.fixture, materializationPath: finalA.issued.materializationPath,
    finalExecutionAuthority: preparedB.finalExecutionAuthority,
  }), /MATERIALIZATION_V2_BINDING_FAILED/);

  const downgrade = await makeReady("binding-v2-downgrade");
  const historicalBindingV2 = await readFile(downgrade.fixture.executionBindingPath);
  await writeFile(downgrade.issued.bindingPath, historicalBindingV2);
  await writeReady(downgrade, ready => ({ ...ready, launcherBindingSha256: hash(historicalBindingV2) }));
  await expectReadyReject(downgrade, null, /EXTERNAL_READY_ARTIFACT_INVALID/);

  const missingV3 = await makeReady("binding-v3-missing");
  await writeFile(path.join(missingV3.externalRoot, "historical-launcher-binding-v2.json"), historicalBindingV2);
  await rm(missingV3.issued.bindingPath);
  await expectReadyReject(missingV3, null, /EXTERNAL_READY_ARTIFACT_MISSING/);

  const replayWrapper = await readFile(valid.issued.wrapperPath);
  await assert.rejects(() => prepareExternalExecutionMaterializationV1({
    repositoryRoot: root, externalRoot: valid.externalRoot, ...valid.fixture, transportPath: valid.transportPath, nodePath: process.execPath,
    receiptRoot: path.join(valid.authorityRoot, "replay-receipts"), evidenceRoot: path.join(valid.authorityRoot, "replay-evidence"),
    materializationEvidenceRoot: path.join(valid.authorityRoot, "replay-materialization-evidence"),
  }), /EXTERNAL_MATERIALIZATION_ROOT_REUSED/);
  assert.deepEqual(await readFile(valid.issued.wrapperPath), replayWrapper);

  async function scanForSecret(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scanForSecret(file);
      else assert.doesNotMatch(await readFile(file, "utf8"), new RegExp(fakePassword));
    }
  }
  await scanForSecret(parent);
  console.log("R6_PRODUCTION_RECONCILIATION_BINDING_V2_EXECUTION_DOWNGRADE_REJECTED");
  console.log("R6_PRODUCTION_RECONCILIATION_EXTERNAL_MATERIALIZATION_FAKE_END_TO_END_PASS");
  console.log("R6_PRODUCTION_RECONCILIATION_EXTERNAL_MATERIALIZATION_V1_COMPLETE_WIP_CHECKPOINT");
} finally {
  await rm(parent, { recursive: true, force: true });
}
