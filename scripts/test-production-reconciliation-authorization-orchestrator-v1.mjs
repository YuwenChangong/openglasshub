import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { issueExecuteApprovalV2 } from "./lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { issueCurrentProductionAuthorizationV1 } from "./lib/r6-production-reconciliation-authorization-orchestrator-v1.mjs";
import { prepareExternalExecutionMaterializationV1, loadExternalExecutionMaterializationReadyV1 } from "./qa/r6-production-reconciliation-external-materialization-v1.mjs";
import { finalizeHumanConfirmation } from "./qa/r6-production-reconciliation-transport.mjs";

const root = process.cwd();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-auth-orchestrator-"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "offline", help: "offline" };
const routing = { PGHOST: "fixture", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" };

function fakeTransport(resultPath, transportSha256) {
  const transportUrl = pathToFileURL(path.join(root, "scripts", "qa", "r6-production-reconciliation-transport.mjs")).href;
  return `import { writeFile } from "node:fs/promises";
import { executeWithFinalExecutionGate } from ${JSON.stringify(transportUrl)};
const [mode, approvalPath, packageRoot, finalConfirmationPath, receiptRoot, candidateRoot, executionBindingPath, materializationPath, launcherBindingPath, evidenceRoot] = process.argv.slice(2);
if (mode === "Preflight") { process.stdout.write(JSON.stringify({ classification: "R6_PRODUCTION_RECONCILIATION_OFFLINE_PREFLIGHT_READY" }) + "\\n"); process.exit(0); }
let calls = 0;
const result = await executeWithFinalExecutionGate({ approvalPath, repositoryRoot: ${JSON.stringify(root)}, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, receiptRoot, evidenceRoot, transportSha256: ${JSON.stringify(transportSha256)}, environment: process.env, sqlClientCapability: ${JSON.stringify(capability)}, clientFactory: () => { calls += 1; return { async targetProbe(){ return { outcome: "TARGET_FAILURE" }; }, async submitMigration(){ throw new Error("FAKE_SQL_MUST_NOT_RUN"); }, async postflight(){ throw new Error("FAKE_POSTFLIGHT_MUST_NOT_RUN"); } }; } });
await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ classification: result.classification, factoryCalls: calls, sqlSubmitted: result.executionAttemptConsumed === true }) + "\\n");`;
}

try {
  const roots = { packageRoot: path.join(parent, "package"), candidateRoot: path.join(parent, "candidate"), executionBindingOutputPath: path.join(parent, "candidate", "execution-binding-v2.json"), testAuthorityRoot: path.join(parent, "confirmation-authority") };
  await assert.rejects(() => issueCurrentProductionAuthorizationV1({ repositoryRoot: root, packageRoot: path.join(parent, "missing-package"), candidateRoot: path.join(parent, "missing-candidate"), testOnly: true, testAuthorityRoot: roots.testAuthorityRoot }), /EXECUTION_BINDING_OUTPUT_INVALID/);
  assert.equal(await readFile(roots.packageRoot).then(() => true).catch(() => false), false);

  const issued = await issueCurrentProductionAuthorizationV1({ repositoryRoot: root, ...roots, testOnly: true });
  assert.equal(issued.sourceCommit, sourceCommit);
  assert.equal(issued.candidateAuthority.candidate.transportImplementationCommit, sourceCommit);
  assert.equal(issued.executionBinding.path, roots.executionBindingOutputPath);
  assert.equal((await readFile(roots.executionBindingOutputPath)).length > 0, true);
  assert.equal(issued.confirmation.value.confirmationPhraseSha256, hash(issued.confirmationIssued.confirmationPhrase));

  const finalConfirmationPath = path.join(parent, "final-v5.json");
  await finalizeHumanConfirmation({ authorizationPath: issued.candidateAuthority.candidateArtifact.path, packageRoot: roots.packageRoot, finalConfirmationPath, confirmationPhrase: issued.confirmationIssued.confirmationPhrase, implementationCommit: sourceCommit, launcherSha256: issued.canonicalLauncherTemplateSha256, transportSha256: issued.transportSha256, sqlClientCapability: capability });
  const approvalPath = path.join(parent, "execute-v2.json");
  await issueExecuteApprovalV2({ outputPath: approvalPath, repositoryRoot: root, packageRoot: roots.packageRoot, candidateRoot: roots.candidateRoot, finalConfirmationPath, executionBindingPath: roots.executionBindingOutputPath });
  const resultPath = path.join(parent, "fake-result.json");
  const transportPath = path.join(parent, "fake-transport.mjs");
  await writeFile(transportPath, fakeTransport(resultPath, issued.transportSha256));
  const externalRoot = path.join(parent, "external");
  const external = await prepareExternalExecutionMaterializationV1({ repositoryRoot: root, externalRoot, approvalPath, packageRoot: roots.packageRoot, candidateRoot: roots.candidateRoot, finalConfirmationPath, executionBindingPath: roots.executionBindingOutputPath, transportPath, transportSha256: issued.transportSha256, nodePath: process.execPath, receiptRoot: path.join(parent, "receipts"), evidenceRoot: path.join(parent, "execution-evidence"), materializationEvidenceRoot: path.join(parent, "materialization-evidence") });
  const ready = await loadExternalExecutionMaterializationReadyV1({ externalRoot, readyInventoryPath: external.readyPath });
  assert.equal(ready.value.sourceCommit, sourceCommit);
  const materialization = JSON.parse(await readFile(external.materializationPath, "utf8"));
  const binding = JSON.parse(await readFile(external.bindingPath, "utf8"));
  assert.equal(ready.value.sourceCommit, materialization.sourceCommit);
  assert.equal(ready.value.sourceCommit, binding.sourceCommit);
  const badReady = JSON.parse(await readFile(external.readyPath, "utf8"));
  await writeFile(external.readyPath, `${JSON.stringify({ ...badReady, sourceCommit: "a".repeat(40) })}\n`);
  await assert.rejects(() => loadExternalExecutionMaterializationReadyV1({ externalRoot, readyInventoryPath: external.readyPath }), /R6_EXTERNAL_READY_SOURCE_COMMIT_MISMATCH/);
  await writeFile(external.readyPath, `${JSON.stringify(badReady)}\n`);
  const fakePassword = "R6_TEST_ONLY_FAKE_PASSWORD";
  const codePoints = [...fakePassword].map(char => char.charCodeAt(0)).join(",");
  const brokerPath = path.join(externalRoot, "r6-production-dpapi-credential-broker.ps1");
  await writeFile(brokerPath, `function Get-R6ProductionPgPasswordSecureString { $s = New-Object Security.SecureString; [char[]](${codePoints}) | ForEach-Object { $s.AppendChar($_) }; $s.MakeReadOnly(); return $s }\n`);
  const brokerSha256 = hash(await readFile(brokerPath));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", external.wrapperPath, "-LauncherPath", external.launcherPath, "-ExpectedLauncherSha256", ready.value.renderedLauncherObservedSha256, "-ExpectedCredentialBrokerSha256", brokerSha256], { cwd: root, env: { ...process.env, ...routing }, stdio: ["ignore", "pipe", "pipe"] });
  const fake = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(fake.classification, "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED");
  assert.equal(fake.factoryCalls, 1);
  assert.equal(fake.sqlSubmitted, false);
  console.log("R6_EXACT_REAL_AUTHORIZATION_ORCHESTRATOR_COVERED=true");
  console.log("R6_PERSISTED_EXECUTION_BINDING_V2_PROVEN=true");
  console.log("R6_FULL_TEMP_EXECUTION_E2E_TO_FAKE_SQL=PASS");
  console.log("R6_READY_LINEAGE_BINDING=PASS");
} finally {
  await rm(parent, { recursive: true, force: true });
}
