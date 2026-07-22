import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION,
  createProjectPhaseState,
  createProjectTerminalResult,
  markProjectPhase,
  runProjectMetadataPreparationCli,
  validateProjectTerminalResult,
  writeProjectTerminalResult,
} from "./qa/run-cloudflare-pages-project-metadata-preparation.mjs";
import { validateProjectTerminalResultFile } from "./qa/validate-r6-pages-project-terminal-result.mjs";

const toolingCommit = "a".repeat(40);
const root = await mkdtemp(path.join(os.tmpdir(), "r6-project-phase-"));
const terminalPath = path.join(root, "evidence", "project-metadata-preparation-terminal-result.json");
const oauth = async () => ({ token: "test-token", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), hasRefreshCapability: false });
const flags = [
  "--operation", R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION,
  "--repository-root", root,
  "--attestation-root", path.join(root, "attestations"),
  "--registry-root", path.join(root, "registry"),
  "--journal-root", path.join(root, "journals"),
  "--evidence-root", path.join(root, "evidence"),
  "--wrapper-path", path.join(root, "wrapper.ps1"),
  "--execution-worktree", root,
  "--tooling-commit", toolingCommit,
  "--wrapper-sha256", "b".repeat(64),
  "--transport-sha256", "c".repeat(64),
  "--parser-selector-sha256", "d".repeat(64),
  "--terminal-result-path", terminalPath,
];

try {
  await mkdir(path.dirname(terminalPath), { recursive: true });
  const prePrompt = createProjectPhaseState();
  await assert.rejects(
    runProjectMetadataPreparationCli(flags, { phaseState: prePrompt, oauthProfileValidator: async () => { throw Object.assign(new Error("expired"), { code: "R6_OAUTH_PROFILE_EXPIRED" }); } }),
    /R6_PAGES_PROJECT_OAUTH_NOT_READY/,
  );
  assert.deepEqual(prePrompt, createProjectPhaseState(), "pre-prompt errors retain all false phases");
  assert.throws(() => markProjectPhase(createProjectPhaseState(), "transportReached"), /R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED/, "transport cannot precede the request sentinel");

  const cancelledPrompt = createProjectPhaseState();
  await assert.rejects(
    runProjectMetadataPreparationCli(flags, { phaseState: cancelledPrompt, oauthProfileValidator: oauth, accountResolver: async ({ requestHiddenInput }) => { await requestHiddenInput(); }, secureInput: async () => { throw Object.assign(new Error("cancelled"), { code: "PAGES_ACCOUNT_ID_INPUT_CANCELLED" }); } }),
    /R6_PAGES_PROJECT_ACCOUNT_INPUT_FAILED/,
  );
  assert.equal(cancelledPrompt.promptReached, true);
  assert.equal(cancelledPrompt.requestSentinelReached, false);
  assert.equal(cancelledPrompt.transportReached, false);

  const aliasesNull = createProjectPhaseState();
  await assert.rejects(
    runProjectMetadataPreparationCli(flags, {
      phaseState: aliasesNull,
      oauthProfileValidator: oauth,
      accountResolver: async ({ requestHiddenInput }) => { await requestHiddenInput(); return { accountId: "a".repeat(32), accountIdSha256: "e".repeat(64) }; },
      secureInput: async () => "a".repeat(32),
      prepare: async (options) => {
        options.onRequestSentinel();
        options.onTransportStart();
        throw Object.assign(new Error("aliases null"), { code: "R6_PAGES_PROJECT_TARGET_MISMATCH", innerCode: "PAGES_PROJECT_GET_REQUIRED_FIELD_NULL:result.canonical_deployment.aliases" });
      },
    }),
    (error) => error?.code === "R6_PAGES_PROJECT_TARGET_MISMATCH",
  );
  assert.deepEqual(aliasesNull, { promptReached: true, requestSentinelReached: true, transportReached: true, attestationCreated: false, validateOnlyCompleted: false });
  markProjectPhase(aliasesNull, "transportReached");
  assert.equal(aliasesNull.transportReached, true, "phase markers remain true after repeated marks");

  const consistentFailure = createProjectTerminalResult({ resultPath: terminalPath, toolingCommit, outerClassification: "R6_PAGES_PROJECT_TARGET_MISMATCH", innerClassification: "PAGES_PROJECT_GET_REQUIRED_FIELD_NULL:result.canonical_deployment.aliases", childExitCode: 1, ...aliasesNull, commands: [] });
  assert.equal(validateProjectTerminalResult(consistentFailure, { resultPath: terminalPath, toolingCommit }).kind, "failure");
  await writeProjectTerminalResult(consistentFailure, terminalPath);
  assert.equal((await validateProjectTerminalResultFile(["--terminal-result-path", terminalPath, "--tooling-commit", toolingCommit])).kind, "failure");
  const impossible = { ...consistentFailure, transportReached: false, resultSha256: null };
  impossible.resultSha256 = createProjectTerminalResult({ resultPath: terminalPath, toolingCommit, outerClassification: impossible.outerClassification, innerClassification: impossible.innerClassification, childExitCode: impossible.childExitCode, promptReached: impossible.promptReached, requestSentinelReached: impossible.requestSentinelReached, transportReached: impossible.transportReached, attestationCreated: impossible.attestationCreated, validateOnlyCompleted: impossible.validateOnlyCompleted, commands: [] }).resultSha256;
  assert.throws(() => validateProjectTerminalResult(impossible, { resultPath: terminalPath, toolingCommit }), /R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE/);
  console.log("R6_PAGES_PROJECT_TERMINAL_PHASE_STATE_OK fake pre-prompt, prompt, aliases-null, terminal digest, and impossible-state contracts passed with zero provider requests");
} finally {
  await rm(root, { recursive: true, force: true });
}
