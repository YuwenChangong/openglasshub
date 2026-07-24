import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS,
  createCurrentCanonicalProductionV3TerminalResult,
} from "./qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";
import { validateCurrentCanonicalProductionV3TerminalFile } from "./qa/validate-r6-current-canonical-production-v3-terminal.mjs";

const toolingCommit = "1d558a54d07a9f425b98e9bcab501b4e644b7ef6";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const root = await mkdtemp(path.join(os.tmpdir(), "r6-v3-terminal-"));
const evidenceRoot = path.join(root, "evidence");
const attestationRoot = path.join(root, "attestations");
const terminalPath = path.join(evidenceRoot, "current-canonical-production-v3-metadata-preparation-terminal-result.json");
const attestationPath = path.join(attestationRoot, "sealed", "production-deployment-attestation.json");

function withDigest(value) {
  value.resultSha256 = sha256(JSON.stringify({ ...value, resultSha256: null }));
  return value;
}

async function writeTerminal(value) {
  await writeFile(terminalPath, `${JSON.stringify(withDigest(value))}\n`);
}

async function assertReject(value, code = /^R6_CURRENT_CANONICAL_V3_TERMINAL_/) {
  await writeTerminal(value);
  await assert.rejects(validateCurrentCanonicalProductionV3TerminalFile({ terminalResultPath: terminalPath, toolingCommit, evidenceRoot, attestationRoot }), (error) => code.test(String(error?.code ?? "")));
}

try {
  await mkdir(path.dirname(attestationPath), { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(attestationPath, "{}\n");
  const success = () => createCurrentCanonicalProductionV3TerminalResult({
    resultPath: terminalPath,
    toolingCommit,
    outerClassification: R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS,
    childExitCode: 0,
    promptReached: true,
    requestSentinelReached: true,
    transportReached: true,
    attestationCreated: true,
    attestationPath,
    attestationSha256: "a".repeat(64),
    validateOnlyCompleted: true,
    commands: ["& 'C:\\safe\\wrapper.ps1' -AuthCheckOnly", "& 'C:\\safe\\wrapper.ps1' -DryRunOnly -RunId 'qa-canary-11111111-1111-4111-8111-111111111111'"],
  });
  const accepted = success();
  await writeTerminal(accepted);
  assert.equal((await validateCurrentCanonicalProductionV3TerminalFile({ terminalResultPath: terminalPath, toolingCommit, evidenceRoot, attestationRoot })).kind, "success");

  const targetFailure = createCurrentCanonicalProductionV3TerminalResult({
    resultPath: terminalPath,
    toolingCommit,
    outerClassification: "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH",
    innerClassification: "PAGES_PROJECT_V3_TARGET_MISMATCH:result.canonical_deployment.url:canonical-deployment-url-v2-observed-current:URL_HOSTNAME_MISMATCH:observed=" + "b".repeat(64),
    childExitCode: 1,
    requestSentinelReached: true,
    transportReached: true,
  });
  await writeTerminal(targetFailure);
  assert.equal((await validateCurrentCanonicalProductionV3TerminalFile({ terminalResultPath: terminalPath, toolingCommit, evidenceRoot, attestationRoot })).classification, "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH");

  const sourceFailure = createCurrentCanonicalProductionV3TerminalResult({
    resultPath: terminalPath,
    toolingCommit,
    outerClassification: "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH",
    innerClassification: "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH:result.canonical_deployment.deployment_trigger.metadata.commit_hash",
    childExitCode: 1,
    requestSentinelReached: true,
    transportReached: true,
  });
  await writeTerminal(sourceFailure);
  assert.equal((await validateCurrentCanonicalProductionV3TerminalFile({ terminalResultPath: terminalPath, toolingCommit, evidenceRoot, attestationRoot })).classification, "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH");

  const cases = [
    ["failure-with-commands", () => ({ ...targetFailure, commandsEmittedCount: 2, commands: success().commands })],
    ["success-with-zero-commands", () => ({ ...success(), commandsEmittedCount: 0, commands: [] })],
    ["success-nonzero-exit", () => ({ ...success(), childExitCode: 1 })],
    ["failure-zero-exit", () => ({ ...targetFailure, childExitCode: 0 })],
    ["validate-without-attestation", () => ({ ...targetFailure, validateOnlyCompleted: true })],
    ["attestation-without-transport", () => ({ ...success(), transportReached: false })],
    ["transport-without-sentinel", () => ({ ...targetFailure, requestSentinelReached: false })],
    ["command-count-mismatch", () => ({ ...success(), commandsEmittedCount: 1 })],
    ["command-order", () => ({ ...success(), commands: [...success().commands].reverse() })],
    ["third-command", () => ({ ...success(), commandsEmittedCount: 3, commands: [...success().commands, "& 'C:\\safe\\wrapper.ps1' -ValidateOnly"] })],
    ["execute-command", () => ({ ...success(), commands: [success().commands[0], "& 'C:\\safe\\wrapper.ps1' -ExecuteApprovedPhase"] })],
    ["unknown-schema", () => ({ ...success(), schemaVersion: "unreviewed" })],
    ["unknown-classification", () => ({ ...targetFailure, outerClassification: "R6_UNREVIEWED" })],
    ["source-with-attestation", () => ({ ...sourceFailure, attestationCreated: true, attestationPath, attestationSha256: "a".repeat(64) })],
    ["target-validate-complete", () => ({ ...targetFailure, attestationCreated: true, attestationPath, attestationSha256: "a".repeat(64), validateOnlyCompleted: true })],
    ["missing-attestation-hash", () => ({ ...success(), attestationSha256: null })],
    ["terminal-path-escape", () => ({ ...success(), sanitizedEvidencePath: path.join(root, "outside.json") })],
    ["malformed-attestation-sha", () => ({ ...success(), attestationSha256: "not-a-sha" })],
    ["secret-like-terminal", () => ({ ...targetFailure, innerClassification: "access_token=denied" })],
  ];
  for (const [name, build] of cases) await assertReject(build(), /^R6_CURRENT_CANONICAL_V3_TERMINAL_/, name);
  console.log("R6_CURRENT_CANONICAL_V3_TERMINAL_VALIDATOR_OK strict schema, safe failures, command contract, and impossible-state rejection passed with zero network");
} finally {
  await rm(root, { recursive: true, force: true });
}
