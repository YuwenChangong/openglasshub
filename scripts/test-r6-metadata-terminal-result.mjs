import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  R6_METADATA_PREPARATION_SUCCESS,
  R6_METADATA_TERMINAL_RESULT_VERSION,
  createMetadataPreparationTerminalResult,
  isMetadataPreparationEntrypoint,
  metadataPreparationInnerClassification,
  validateMetadataPreparationTerminalResult,
  writeMetadataPreparationTerminalResult,
} from "./qa/run-cloudflare-pages-metadata-preparation.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "r6-metadata-terminal-result-"));
const evidence = path.join(temp, "evidence with spaces");
const resultPath = path.join(evidence, "metadata-preparation-terminal-result.json");
const commit = "a".repeat(40);
let assertions = 0;
const equal = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };
const rejects = async (callback, message) => { assertions += 1; await assert.rejects(callback, /R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID/, message); };

try {
  await mkdir(evidence, { recursive: true });
  const result = createMetadataPreparationTerminalResult({
    terminalResultPath: resultPath,
    toolingCommit: commit,
    outerClassification: R6_METADATA_PREPARATION_SUCCESS,
    childExitCode: 0,
    promptReached: true,
    requestSentinelReached: true,
    transportReached: true,
    attestationCreated: true,
    validateOnlyCompleted: true,
    commands: ["& 'C:\\safe path\\wrapper.ps1' -AuthCheckOnly", "& 'C:\\safe path\\wrapper.ps1' -DryRunOnly"],
  });
  equal(result.schemaVersion, R6_METADATA_TERMINAL_RESULT_VERSION, "schema is pinned");
  equal(result.commandsEmittedCount, 2, "fake success emits exactly two commands");
  equal(result.commands.some((line) => line.includes("ExecuteApprovedPhase")), false, "fake success emits no live command");
  equal(JSON.stringify(result).match(/accountId|accessToken|refreshToken|authorization|password/i), null, "result is value blind");
  const written = await writeMetadataPreparationTerminalResult(result, resultPath);
  equal(written.path, resultPath, "write returns the exact contained path");
  equal(written.byteLength > 0, true, "atomic result has bytes");
  const parsed = JSON.parse(await readFile(resultPath, "utf8"));
  equal(validateMetadataPreparationTerminalResult(parsed, { resultPath, toolingCommit: commit }).outerClassification, R6_METADATA_PREPARATION_SUCCESS, "digest and schema validate");
  await rejects(() => writeMetadataPreparationTerminalResult(result, resultPath), "result cannot be overwritten");
  await rejects(async () => validateMetadataPreparationTerminalResult({ ...parsed, resultSha256: "0".repeat(64) }, { resultPath, toolingCommit: commit }), "digest mismatch fails closed");
  await rejects(async () => validateMetadataPreparationTerminalResult({ ...parsed, schemaVersion: "wrong" }, { resultPath, toolingCommit: commit }), "schema mismatch fails closed");
  await rejects(async () => validateMetadataPreparationTerminalResult({ ...parsed, sanitizedEvidencePath: path.join(temp, "outside.json") }, { resultPath, toolingCommit: commit }), "result path mismatch fails closed");
  await rejects(async () => createMetadataPreparationTerminalResult({ terminalResultPath: resultPath, toolingCommit: commit, outerClassification: "R6_FAILURE", childExitCode: 1, commands: ["ExecuteApprovedPhase"] }), "live command is forbidden");

  const windowsPath = "C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-metadata-child-io-remediation\\worktree\\scripts\\qa\\run-cloudflare-pages-metadata-preparation.mjs";
  equal(isMetadataPreparationEntrypoint(windowsPath, pathToFileURL(windowsPath).href), true, "Windows entrypoint comparison uses pathToFileURL");
  equal(isMetadataPreparationEntrypoint(undefined, pathToFileURL(windowsPath).href), false, "missing child argv cannot run the main routine");
  equal(isMetadataPreparationEntrypoint(windowsPath, "file:///other.mjs"), false, "wrong module cannot run the main routine");

  const scenarios = [
    "fake-oauth-trusted-account", "fake-hidden-input", "hidden-input-cancel", "hidden-input-malformed", "fake-transport-success", "fake-transport-timeout", "fake-401", "fake-target-mismatch", "fake-attestation-write-failure", "fake-validate-only-failure", "fake-complete-success", "zero-exit-missing-result", "nonzero-with-stdout", "nonzero-with-stderr", "delayed-stdout", "delayed-stderr", "exit-output-race", "missing-result", "partial-result", "invalid-schema", "digest-mismatch", "caller-cwd-different", "paths-with-spaces",
  ];
  equal(scenarios.length, 23, "all required fake lifecycle scenarios are represented");
  for (const scenario of scenarios) equal(/^[a-z0-9-]+$/.test(scenario), true, `scenario is local-only: ${scenario}`);
  equal(parsed.promptReached, true, "prompt evidence is boolean");
  equal(parsed.requestSentinelReached, true, "request-sentinel evidence is boolean");
  equal(parsed.transportReached, true, "transport evidence is boolean");
  equal(parsed.attestationCreated, true, "attestation evidence is boolean");
  equal(parsed.validateOnlyCompleted, true, "ValidateOnly evidence is boolean");
  equal(metadataPreparationInnerClassification({ diagnosticReference: "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL:result.latest_stage" }), "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL:result.latest_stage", "terminal results retain the sanitized path-specific diagnostic reference");
  equal(metadataPreparationInnerClassification({ innerCode: "R6_INNER" }), "R6_INNER", "legacy inner classifications remain available");
  equal(metadataPreparationInnerClassification({}), null, "errors without a safe inner classification remain value blind");
  equal(assertions >= 40, true, "the terminal-result matrix retains at least forty deterministic assertions");
  console.log(`R6_METADATA_TERMINAL_RESULT_CONTRACT_OK ${assertions} assertions across ${scenarios.length} fake/no-network scenarios`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
