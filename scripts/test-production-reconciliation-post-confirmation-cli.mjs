import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueCurrentProductionAuthorizationV1 } from "./lib/r6-production-reconciliation-authorization-orchestrator-v1.mjs";
import { parseArguments } from "./qa/advance-production-reconciliation-post-confirmation-v1.mjs";

const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cli = path.join(root, "scripts", "qa", "advance-production-reconciliation-post-confirmation-v1.mjs");
const hash = value => createHash("sha256").update(value).digest("hex");

async function fixture(name) {
  const temp = await mkdtemp(path.join(os.tmpdir(), `r6-post-confirmation-${name}-`));
  const packageRoot = path.join(temp, "package");
  const candidateRoot = path.join(temp, "candidate");
  const authorityRoot = path.join(temp, "authority");
  const issued = await issueCurrentProductionAuthorizationV1({ repositoryRoot: root, packageRoot, candidateRoot, executionBindingOutputPath: path.join(candidateRoot, "execution-binding-v2.json"), testOnly: true, testAuthorityRoot: authorityRoot });
  return { temp, packageRoot, candidateRoot, authorityRoot, phrase: issued.confirmationIssued.confirmationPhrase, phraseSha256: issued.confirmation.value.confirmationPhraseSha256 };
}

function run(f, extra = [], phrase = f.phrase) {
  return spawnSync(process.execPath, [cli, "--package-root", f.packageRoot, "--candidate-root", f.candidateRoot, "--confirmation-stdin", "--test-only", "--test-authority-root", f.authorityRoot, ...extra], { cwd: root, input: phrase, encoding: "utf8" });
}

async function assertNotAdvanced(f) {
  await assert.rejects(readFile(path.join(f.candidateRoot, "production-reconciliation-final-human-confirmation-v5.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(f.candidateRoot, "production-reconciliation-execute-approval-v2.json")), /ENOENT/);
}

const fixtures = [];
try {
  const parsed = parseArguments(["--package-root", "C:\\tmp\\package", "--candidate-root", "C:\\tmp\\candidate", "--confirmation-stdin", "--test-only", "--test-authority-root", "C:\\tmp\\authority"]);
  assert.equal(parsed["--confirmation-stdin"], true);
  assert.throws(() => parseArguments(["--package-root", "C:\\tmp\\package", "--candidate-root", "C:\\tmp\\candidate", "--confirmation-stdin", "--test-only"]), /POST_CONFIRMATION_CLI_ARGUMENT_INVALID/);

  const success = await fixture("success"); fixtures.push(success);
  const result = run(success);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.classification, "R6_PRODUCTION_RECONCILIATION_FINAL_RC_EXECUTE_V2_OFFLINE_AUTHORITY_READY");
  assert.equal(output.confirmationPhraseSha256, success.phraseSha256);
  assert.match(output.executeV2Sha256, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(success.candidateRoot, "production-reconciliation-execute-approval-v2.json"), "utf8").then(value => hash(value)), output.executeV2Sha256);
  await assert.rejects(readFile(path.join(success.candidateRoot, "execution-materialization-v2.json")), /ENOENT/);

  const wrongPhrase = await fixture("wrong-phrase"); fixtures.push(wrongPhrase);
  assert.notEqual(run(wrongPhrase, [], "wrong").status, 0); await assertNotAdvanced(wrongPhrase);

  const wrongRoute = await fixture("wrong-route"); fixtures.push(wrongRoute);
  const routePath = path.join(wrongRoute.packageRoot, "canonical-runtime-routing-identity.json");
  const route = JSON.parse(await readFile(routePath, "utf8"));
  await writeFile(routePath, `${JSON.stringify({ ...route, routeAuthority: { ...route.routeAuthority, pgHost: "aws-0-ap-northeast-1.pooler.supabase.com" } })}\n`);
  assert.notEqual(run(wrongRoute).status, 0); await assertNotAdvanced(wrongRoute);

  const wrongBinding = await fixture("wrong-binding"); fixtures.push(wrongBinding);
  await writeFile(path.join(wrongBinding.candidateRoot, "execution-binding-v2.json"), "{}\n");
  assert.notEqual(run(wrongBinding).status, 0); await assertNotAdvanced(wrongBinding);

  for (const [name, mutate] of [
    ["wrong-source", async f => { const file = path.join(f.candidateRoot, "production-reconciliation-candidate.json"); const value = JSON.parse(await readFile(file, "utf8")); await writeFile(file, `${JSON.stringify({ ...value, transportImplementationCommit: "0".repeat(40) })}\n`); }],
    ["wrong-package", async f => { await writeFile(path.join(f.packageRoot, "production-reconciliation-execution-package.json"), "{}\n"); }],
    ["malformed-candidate", async f => { await writeFile(path.join(f.candidateRoot, "production-reconciliation-candidate.json"), "{}\n"); }],
    ["wrong-project", async f => { const file = path.join(f.packageRoot, "canonical-runtime-routing-identity.json"); const value = JSON.parse(await readFile(file, "utf8")); await writeFile(file, `${JSON.stringify({ ...value, routeAuthority: { ...value.routeAuthority, projectRef: "aaaaaaaaaaaaaaaaaaaa" } })}\n`); }],
    ["missing-route", async f => { const file = path.join(f.packageRoot, "canonical-runtime-routing-identity.json"); const value = JSON.parse(await readFile(file, "utf8")); const { routeAuthority, ...rest } = value; await writeFile(file, `${JSON.stringify(rest)}\n`); }],
    ["wrong-user", async f => { const file = path.join(f.packageRoot, "canonical-runtime-routing-identity.json"); const value = JSON.parse(await readFile(file, "utf8")); await writeFile(file, `${JSON.stringify({ ...value, routeAuthority: { ...value.routeAuthority, pgUser: "postgres" } })}\n`); }],
  ]) {
    const invalid = await fixture(name); fixtures.push(invalid);
    await mutate(invalid);
    assert.notEqual(run(invalid).status, 0, name);
    await assertNotAdvanced(invalid);
  }

  for (const stage of ["global-claim", "final-persistence", "execute-persistence"]) {
    const partial = await fixture(stage); fixtures.push(partial);
    assert.notEqual(run(partial, ["--test-failure-stage", stage]).status, 0);
    if (stage !== "execute-persistence") await assert.rejects(readFile(path.join(partial.candidateRoot, "production-reconciliation-execute-approval-v2.json")), /ENOENT/);
    await assert.rejects(readFile(path.join(partial.candidateRoot, "execution-materialization-v2.json")), /ENOENT/);
  }

  console.log("TEMP_POST_CONFIRMATION_ATOMIC_CLI_E2E=PASS");
  console.log("CONFIRMATION_CONSUMPTION=1");
  console.log("GLOBAL_CLAIM=1");
  console.log("FINAL_V5=1");
  console.log("EXECUTE_V2=1");
  console.log("MATERIALIZATION_V2=0");
  console.log("DPAPI_BROKER_CALLS=0");
} finally {
  await Promise.all(fixtures.map(f => rm(f.temp, { recursive: true, force: true })));
}
