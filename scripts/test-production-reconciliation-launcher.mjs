import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCanonicalLauncherTemplateAuthority } from "./lib/r6-canonical-launcher-template-authority.mjs";
import { renderProductionReconciliationLauncherV3 } from "./qa/render-r6-production-reconciliation-launcher.mjs";

const root = process.cwd();
const hash = value => createHash("sha256").update(value).digest("hex");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-launcher-v3-"));
try {
  const canonical = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot: root });
  const approvalPath = path.join(temp, "execute-v2.json");
  await writeFile(approvalPath, "{}\n");
  const authoritySha256 = hash("final-authority");
  const materialization = { schemaVersion: "r6-production-reconciliation-execution-materialization-v2", sourceCommit: commit, packageId: randomUUID(), executionPackageSha256: hash("package"), manifestSha256: hash("manifest"), candidateId: randomUUID(), candidateSha256: hash("candidate"), candidateTerminalSha256: hash("terminal"), candidateInventorySha256: hash("inventory"), finalConfirmationSchemaVersion: "r6-production-reconciliation-final-human-confirmation-v5", finalConfirmationSha256: hash("final"), executeApprovalSchemaVersion: "r6-production-reconciliation-execute-approval-v2", executeApprovalSha256: hash(await readFile(approvalPath)), finalExecutionAuthoritySchemaVersion: "r6-production-reconciliation-final-execution-authority-v2", finalExecutionAuthoritySha256: authoritySha256, globalConsumptionClaimSha256: hash("claim"), targetIdentityCanonicalSha256: hash("target"), runtimeRoutingCanonicalSha256: hash("routing"), expectedProjectRef: "xcbnxzjlsvtgzixurcof", launcherBindingSchemaVersion: "r6-production-reconciliation-launcher-binding-v3", canonicalLauncherTemplateSha256: canonical.canonicalLauncherTemplateSha256, secureWrapperSha256: hash("wrapper"), issuedAtUtc: new Date().toISOString() };
  const materializationPath = path.join(temp, "materialization-v2.json");
  const materializationBytes = Buffer.from(`${JSON.stringify(materialization)}\n`);
  await writeFile(materializationPath, materializationBytes);
  const bindingPath = path.join(temp, "binding-v3.json");
  const binding = { schemaVersion: "r6-production-reconciliation-launcher-binding-v3", sourceCommit: commit, packageId: materialization.packageId, materializationPath, materializationSha256: hash(materializationBytes), executeApprovalPath: approvalPath, executeApprovalSha256: materialization.executeApprovalSha256, finalExecutionAuthoritySchemaVersion: materialization.finalExecutionAuthoritySchemaVersion, finalExecutionAuthoritySha256: authoritySha256, launcherPath: path.join(temp, "launcher.ps1"), canonicalLauncherTemplateSha256: canonical.canonicalLauncherTemplateSha256, secureWrapperSha256: hash("wrapper"), expectedProjectRef: materialization.expectedProjectRef, singleUse: true, immutable: true };
  await writeFile(bindingPath, `${JSON.stringify(binding)}\n`);
  const fakeTransport = path.join(temp, "fake-transport.mjs");
  const invocation = path.join(temp, "invocation.json");
  await writeFile(fakeTransport, `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(invocation)}, JSON.stringify(process.argv.slice(2)));`);
  const config = { repositoryRoot: root, materializationPath, launcherBindingPath: bindingPath, transportPath: fakeTransport, transportSha256: hash(await readFile(fakeTransport)), nodePath: process.execPath, approvalPath, packageRoot: temp, candidateRoot: temp, finalConfirmationPath: path.join(temp, "final.json"), executionBindingPath: path.join(temp, "legacy-binding.json"), receiptRoot: path.join(temp, "receipts"), evidenceRoot: path.join(temp, "evidence") };
  const destination = binding.launcherPath;
  await renderProductionReconciliationLauncherV3({ config, destination });
  const rendered = await readFile(destination, "utf8");
  assert.match(rendered, /launcherBindingPath/); assert.match(rendered, /materializationPath/); assert.match(rendered, / Execute /);
  assert.doesNotMatch(rendered, /launcher-binding-v2|FinalizeHumanConfirmation|ValidateOnly/);
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", destination], { stdio: "pipe" });
  const args = JSON.parse(await readFile(invocation, "utf8"));
  assert.deepEqual(args.slice(0, 1), ["Execute"]);
  assert.equal(args.includes(materializationPath), true); assert.equal(args.includes(bindingPath), true);
  const badDestination = path.join(temp, "bad-launcher.ps1");
  await assert.rejects(() => renderProductionReconciliationLauncherV3({ config: { ...config, launcherBindingPath: path.join(temp, "missing.json") }, destination: badDestination }), /LAUNCHER_V3_BINDING_MISSING/);
  await assert.rejects(readFile(badDestination), /ENOENT/);
  for (const [name, mutateBinding, mutateMaterialization] of [
    ["binding-v2", value => ({ ...value, schemaVersion: "r6-production-reconciliation-launcher-binding-v2" }), value => value],
    ["materialization-sha", value => ({ ...value, materializationSha256: hash("wrong-materialization") }), value => value],
    ["project", value => ({ ...value, expectedProjectRef: "aaaaaaaaaaaaaaaaaaaa" }), value => value],
    ["source", value => ({ ...value, sourceCommit: "b".repeat(40) }), value => value],
    ["cross-lineage", value => value, value => ({ ...value, packageId: randomUUID() })],
  ]) {
    await writeFile(bindingPath, `${JSON.stringify(mutateBinding(binding))}\n`);
    await writeFile(materializationPath, `${JSON.stringify(mutateMaterialization(materialization))}\n`);
    const rejectedDestination = path.join(temp, `${name}.ps1`);
    await assert.rejects(() => renderProductionReconciliationLauncherV3({ config, destination: rejectedDestination }), /LAUNCHER_V3_(BINDING|LINEAGE|MATERIALIZATION)_INVALID/);
    await assert.rejects(readFile(rejectedDestination), /ENOENT/);
    await writeFile(bindingPath, `${JSON.stringify(binding)}\n`);
    await writeFile(materializationPath, materializationBytes);
  }
  console.log("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_RENDERER_PASS");
  console.log("R6_PRODUCTION_RECONCILIATION_RENDERED_POWERSHELL_FAKE_INTEGRATION_PASS");
} finally { await rm(temp, { recursive: true, force: true }); }
