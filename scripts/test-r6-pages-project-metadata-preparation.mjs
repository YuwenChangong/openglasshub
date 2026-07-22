import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION,
  allocateProjectUnreservedDryRunId,
  createProjectSingleRequestSentinel,
  createProjectTerminalResult,
  emitProjectAuthDryRunCommands,
  prepareProjectAuthDryRunAttestation,
  runProjectMetadataPreparationCli,
  writeProjectTerminalResult,
} from "./qa/run-cloudflare-pages-project-metadata-preparation.mjs";
import { validateDeploymentAttestation } from "./qa/production-deployment-attestation.mjs";

const accountId = "a".repeat(32);
const deploymentId = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
const sourceCommit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const toolingCommit = "bbba028dbf240d06b97a7a46ab5c11ccd6a7b8ea";
const root = await mkdtemp(path.join(os.tmpdir(), "r6-project-metadata-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const envelope = () => JSON.stringify({ success: true, errors: [], result: {
  id: "project-id", name: "openglasshub", production_branch: "main",
  canonical_deployment: { id: deploymentId, environment: "production", url: `https://${deploymentId}.openglasshub.pages.dev/`, aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: sourceCommit } }, latest_stage: { name: "deploy", status: "success" }, is_skipped: false },
  latest_deployment: { id: deploymentId, environment: "production", url: `https://${deploymentId}.openglasshub.pages.dev/`, aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: sourceCommit } }, latest_stage: { name: "deploy", status: "success" }, is_skipped: false },
} });
try {
  const registry = path.join(root, "registry"); const journals = path.join(root, "journals"); const attestations = path.join(root, "attestations"); const evidence = path.join(root, "evidence");
  await Promise.all([mkdir(registry), mkdir(journals), mkdir(attestations), mkdir(evidence)]);
  const empty = { schemaVersion: "consumed-run-registry-v1", entries: [] };
  const integrity = hash(JSON.stringify(empty));
  await writeFile(path.join(registry, "consumed-run-registry-v1.json"), JSON.stringify({ ...empty, integrity }));
  await writeFile(path.join(registry, "confirmation-token-ledger-v1.json"), JSON.stringify(empty));
  let requests = 0; let validations = 0;
  const result = await prepareProjectAuthDryRunAttestation({
    resolvedAccount: { accountId, accountIdSha256: hash(accountId) }, auth: { token: "test.oauth.token" }, environment: {}, fetchImpl: async (url, init) => { requests += 1; assert.match(url, /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/a{32}\/pages\/projects\/openglasshub$/); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); return new Response(envelope(), { status: 200, headers: { "content-type": "application/json" } }); },
    attestationRoot: attestations, registryRoot: registry, journalRoot: journals, evidenceRoot: evidence, wrapperPath: "C:\\safe path\\wrapper.ps1", executionWorktree: "C:\\safe path\\execution", toolingCommit, wrapperSha256: "b".repeat(64), transportSha256: "c".repeat(64), parserSelectorSha256: "d".repeat(64),
    validateOnly: async ({ attestationPath, attestationSha256 }) => { validations += 1; return validateDeploymentAttestation({ attestationPath, expectedSha256: attestationSha256, expectedCommit: sourceCommit, expectedToolingCommit: toolingCommit, root: attestations }); },
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(requests, 1, "exactly one fake Project GET is allowed"); assert.equal(validations, 1, "ValidateOnly runs after sealing");
  assert.equal(result.classification, "R6_PAGES_PROJECT_METADATA_PREPARATION_OK"); assert.equal(result.dryRunId, "qa-canary-11111111-1111-4111-8111-111111111111");
  assert.equal(JSON.stringify(result.attestation.document).includes(accountId), false, "account ID never enters Project attestation");
  assert.equal(result.commands.authCheckOnly.includes("ExecuteApprovedPhase"), false); assert.equal(result.commands.dryRunOnly.includes("ExecuteApprovedPhase"), false);
  assert.match(result.commands.authCheckOnly, /-AuthCheckOnly/); assert.match(result.commands.dryRunOnly, /-DryRunOnly/);
  const sealed = await readFile(result.attestation.path); assert.equal(hash(sealed), result.attestation.sha256);
  await assert.rejects(prepareProjectAuthDryRunAttestation({ resolvedAccount: { accountId, accountIdSha256: hash(accountId) }, auth: { token: "test.oauth.token" }, environment: {}, fetchImpl: async () => { throw new Error("must not fetch"); }, attestationRoot: attestations, registryRoot: registry, journalRoot: journals, evidenceRoot: evidence, wrapperPath: "x", executionWorktree: "x", toolingCommit, wrapperSha256: "b".repeat(64), transportSha256: "c".repeat(64), parserSelectorSha256: "d".repeat(64), validateOnly: async () => {}, assertOAuthReady: () => { throw Object.assign(new Error("expired"), { code: "R6_OAUTH_PROFILE_EXPIRED" }); } }), /R6_PAGES_PROJECT_OAUTH_NOT_READY/);
  const sentinel = createProjectSingleRequestSentinel(); sentinel(); assert.throws(() => sentinel(), /R6_PAGES_PROJECT_TRANSPORT_FAILED/);
  const atThreshold = await allocateProjectUnreservedDryRunId({ registryRoot: registry, journalRoot: journals, evidenceRoot: evidence, randomUuid: () => "22222222-2222-4222-8222-222222222222" }); assert.match(atThreshold, /^qa-canary-/);
  const commands = emitProjectAuthDryRunCommands({ wrapperPath: "C:\\safe path\\wrapper.ps1", executionWorktree: "C:\\safe path\\execution", attestation: result.attestation, dryRunId: result.dryRunId, evidenceRoot: evidence }); assert.equal(Object.keys(commands).length, 2);
  const terminalPath = path.join(evidence, "project-metadata-preparation-terminal-result.json");
  const terminal = createProjectTerminalResult({ resultPath: terminalPath, toolingCommit, outerClassification: "R6_PAGES_PROJECT_TARGET_MISMATCH", innerClassification: "PAGES_PROJECT_GET_TARGET_MISMATCH:result.name", childExitCode: 1 });
  await writeProjectTerminalResult(terminal, terminalPath); await assert.rejects(writeProjectTerminalResult(terminal, terminalPath), /R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED/);
  await assert.rejects(runProjectMetadataPreparationCli(["--operation", R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION, "--account-id", accountId], { oauthProfileValidator: async () => { throw new Error("must not inspect OAuth for rejected flags"); } }), /R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED/);
  assert.equal(R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION, "PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION");
  console.log("R6_PAGES_PROJECT_METADATA_PREPARATION_OK fake Project GET, Model A, Project attestation, shared ValidateOnly, validity, unreserved dry-run ID, and two-command contract passed without network");
} finally { await rm(root, { recursive: true, force: true }); }
