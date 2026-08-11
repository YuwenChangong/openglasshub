import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { buildAuthorizationV4FromPackage } from "./lib/r6-production-reconciliation-authorization-v3.mjs";
import { finalizeHumanConfirmation, validateFinalExecutionBinding } from "./qa/r6-production-reconciliation-transport.mjs";

const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const hash = value => createHash("sha256").update(value).digest("hex");
const launcherSha256 = hash("global-claim-launcher");
const transportSha256 = hash("global-claim-transport");
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "psql offline", help: "offline" };

async function fixture(phrase = "global-single-use-phrase") {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r6-global-confirmation-"));
  const packageRoot = path.join(temp, "package");
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot: root, implementationCommit: commit, launcherSha256, secureWrapperSha256: hash("wrapper"), baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a" });
  const candidate = await buildAuthorizationV4FromPackage({ packageRoot, repositoryRoot: root, transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, requiredConfirmationPhrase: phrase });
  const authorizationPath = path.join(temp, "candidate-v4.json");
  await writeFile(authorizationPath, `${JSON.stringify(candidate)}\n`);
  const core = { authorizationPath, packageRoot, implementationCommit: commit, launcherSha256, transportSha256, sqlClientCapability: capability };
  return { temp, phrase, candidate, core };
}

const fixtures = [];
try {
  const first = await fixture(); fixtures.push(first);
  const firstPath = path.join(first.temp, "final-a.json");
  await finalizeHumanConfirmation({ ...first.core, finalConfirmationPath: firstPath, confirmationPhrase: first.phrase });
  await validateFinalExecutionBinding({ ...first.core, finalConfirmationPath: firstPath });
  await assert.rejects(() => finalizeHumanConfirmation({ ...first.core, finalConfirmationPath: path.join(first.temp, "final-b.json"), confirmationPhrase: first.phrase }), /CONFIRMATION_PHRASE_GLOBALLY_CONSUMED/);
  await assert.rejects(() => finalizeHumanConfirmation({ ...first.core, finalConfirmationPath: firstPath, confirmationPhrase: first.phrase }), /CONFIRMATION_PHRASE_GLOBALLY_CONSUMED/);

  const wrong = await fixture(); fixtures.push(wrong);
  await assert.rejects(() => finalizeHumanConfirmation({ ...wrong.core, finalConfirmationPath: path.join(wrong.temp, "wrong.json"), confirmationPhrase: "wrong" }), /CONFIRMATION_INVALID/);
  const otherCandidate = await fixture("other-candidate-phrase"); fixtures.push(otherCandidate);
  await assert.rejects(() => finalizeHumanConfirmation({ ...otherCandidate.core, finalConfirmationPath: path.join(otherCandidate.temp, "cross-candidate.json"), confirmationPhrase: first.phrase }), /CONFIRMATION_INVALID/);

  const concurrent = await fixture(); fixtures.push(concurrent);
  const concurrentResults = await Promise.allSettled(["a", "b"].map(name => finalizeHumanConfirmation({ ...concurrent.core, finalConfirmationPath: path.join(concurrent.temp, `concurrent-${name}.json`), confirmationPhrase: concurrent.phrase })));
  assert.equal(concurrentResults.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(concurrentResults.filter(result => result.status === "rejected" && /CONFIRMATION_PHRASE_GLOBALLY_CONSUMED/.test(result.reason?.message)).length, 1);

  const crashed = await fixture(); fixtures.push(crashed);
  const crashedPath = path.join(crashed.temp, "crashed.json");
  await assert.rejects(() => finalizeHumanConfirmation({ ...crashed.core, finalConfirmationPath: crashedPath, confirmationPhrase: crashed.phrase, afterClaimForTest: async () => { throw Object.assign(new Error("simulated crash"), { code: "SIMULATED_CRASH" }); } }), /simulated crash/);
  await assert.rejects(readFile(crashedPath), /ENOENT/);
  await assert.rejects(() => finalizeHumanConfirmation({ ...crashed.core, finalConfirmationPath: path.join(crashed.temp, "after-crash.json"), confirmationPhrase: crashed.phrase }), /CONFIRMATION_PHRASE_GLOBALLY_CONSUMED/);

  const tampered = JSON.parse(await readFile(firstPath, "utf8"));
  const claim = JSON.parse(await readFile(tampered.globalConsumptionClaimPathOrKey, "utf8"));
  for (const [field, replacement] of [["packageId", "00000000-0000-4000-8000-000000000000"], ["candidateId", "00000000-0000-4000-8000-000000000001"], ["confirmationPhraseSha256", hash("tampered-phrase")], ["sourceCommit", "0000000000000000000000000000000000000000"]]) {
    await writeFile(tampered.globalConsumptionClaimPathOrKey, `${JSON.stringify({ ...claim, [field]: replacement })}\n`);
    await assert.rejects(() => validateFinalExecutionBinding({ ...first.core, finalConfirmationPath: firstPath }), /GLOBAL_CONFIRMATION_CLAIM_INVALID/);
  }
  await writeFile(tampered.globalConsumptionClaimPathOrKey, `${JSON.stringify(claim)}\n`);
  const historicalPath = path.join(first.temp, "historical-final-v2.json");
  await writeFile(historicalPath, `${JSON.stringify({ schemaVersion: "qa-production-reconciliation-final-human-confirmation-v2" })}\n`);
  await assert.rejects(() => validateFinalExecutionBinding({ ...first.core, finalConfirmationPath: historicalPath }), /FINAL_CONFIRMATION_V4_INVALID/);
  console.log("R6_PRODUCTION_RECONCILIATION_GLOBAL_CONFIRMATION_CONSUMPTION_PASS");
} finally {
  await Promise.all(fixtures.map(value => rm(value.temp, { recursive: true, force: true })));
}
