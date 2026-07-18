import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareAuthDryRunAttestation } from "./qa/run-cloudflare-pages-metadata-preparation.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "r6-metadata-")); const accountId = "a".repeat(32); const deploymentId = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a"; const sourceCommit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
try {
  const repo = path.join(temp, "repo"); const registry = path.join(temp, "registry"); const journals = path.join(temp, "journals"); const attestations = path.join(temp, "attestations");
  await mkdir(repo, { recursive: true }); await mkdir(registry); await mkdir(journals); await mkdir(attestations);
  await writeFile(path.join(repo, "wrangler.toml"), `account_id = "${accountId}"\n`);
  const empty = { schemaVersion: "consumed-run-registry-v1", entries: [] }; const digest = (value) => { const copy = { ...value }; delete copy.integrity; return createHash("sha256").update(JSON.stringify(copy)).digest("hex"); };
  // Use the committed registry shape without reserving anything.
  const ledger = { schemaVersion: "consumed-run-registry-v1", entries: [] }; const registryDoc = { ...empty, integrity: digest(empty) };
  await writeFile(path.join(registry, "consumed-run-registry-v1.json"), JSON.stringify(registryDoc)); await writeFile(path.join(registry, "confirmation-token-ledger-v1.json"), JSON.stringify(ledger));
  let calls = 0; let validateCalls = 0;
  const result = await prepareAuthDryRunAttestation({ repositoryRoot: repo, deploymentId, sourceCommit, auth: { token: "test_token.value" }, environment: {}, registryRoot: registry, journalRoot: journals, evidenceRoot: path.join(temp, "evidence"), wrapperPath: "C:\\safe path\\wrapper.ps1", executionWorktree: "C:\\safe path\\execution", toolingCommit: "2d698c33d821e0dce1fff26a06b75373531f8ac0", wrapperSha256: "b".repeat(64), transportSha256: "c".repeat(64), parserSelectorSha256: "d".repeat(64), endpointSha256: "e".repeat(64), attestationRoot: attestations, validateOnly: async () => { validateCalls += 1; }, fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ success: true, errors: [], result: { id: deploymentId, project_name: "openglasshub", environment: "production", url: "https://6f11bcf1.openglasshub.pages.dev/", aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: sourceCommit } }, latest_stage: { name: "deploy", status: "success" }, is_skipped: false } }), { status: 200 }); } });
  assert.equal(calls, 1); assert.equal(validateCalls, 1); assert.match(result.dryRunId, /^qa-canary-/); assert.equal(result.commands.authCheckOnly.includes(accountId), false); assert.equal(result.commands.dryRunOnly.includes("ExecuteApprovedPhase"), false); assert.equal(JSON.stringify(result.attestation.document).includes(accountId), false); assert.equal((await readFile(path.join(registry, "consumed-run-registry-v1.json"), "utf8")), JSON.stringify(registryDoc));
  let expiredBeforeRequestCalls = 0;
  await assert.rejects(prepareAuthDryRunAttestation({ repositoryRoot: repo, deploymentId, sourceCommit, auth: { token: "test_token.value" }, environment: {}, registryRoot: registry, journalRoot: journals, evidenceRoot: path.join(temp, "evidence"), wrapperPath: "C:\\safe path\\wrapper.ps1", executionWorktree: "C:\\safe path\\execution", toolingCommit: "2d698c33d821e0dce1fff26a06b75373531f8ac0", wrapperSha256: "b".repeat(64), transportSha256: "c".repeat(64), parserSelectorSha256: "d".repeat(64), endpointSha256: "e".repeat(64), attestationRoot: attestations, validateOnly: async () => {}, requestSentinel: () => { expiredBeforeRequestCalls += 1; }, assertOAuthReady: () => { throw Object.assign(new Error("expired"), { code: "R6_OAUTH_PROFILE_EXPIRED" }); }, fetchImpl: async () => { throw new Error("fake HTTP must remain unreachable"); } }), (error) => error?.code === "R6_OAUTH_PROFILE_EXPIRED");
  assert.equal(expiredBeforeRequestCalls, 0, "recheck failure must happen before the request sentinel and fake HTTP");
  console.log("R6_METADATA_PREPARATION_OK fake one-request orchestration, sealing, ValidateOnly ordering, unreserved dry-run ID, and two-command emission passed without network");
} finally { await rm(temp, { recursive: true, force: true }); }
