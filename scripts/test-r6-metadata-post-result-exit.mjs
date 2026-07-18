import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { R6_METADATA_POST_RESULT_PROCESS_EXIT_FAILED, validateMetadataPreparationTerminalResult } from "./qa/run-cloudflare-pages-metadata-preparation.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const runnerUrl = pathToFileURL(path.join(scriptsRoot, "qa", "run-cloudflare-pages-metadata-preparation.mjs")).href;
const toolingCommit = "6c505d3eb768f58ee9f8866790ea73243b4209e8";
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-metadata-post-result-exit-"));

function runChild(program) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", program], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => { child.kill(); reject(new Error(R6_METADATA_POST_RESULT_PROCESS_EXIT_FAILED)); }, 2_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
}

try {
  const scenarios = [
    { name: "success", input: [...Buffer.from(`${"a".repeat(32)}\r`)], outerClassification: "R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION", innerClassification: null, childExitCode: 0 },
    { name: "aliases-null", input: [...Buffer.from(`${"a".repeat(32)}\r`)], outerClassification: "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL", innerClassification: "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL:result.aliases", childExitCode: 1 },
    { name: "prompt-cancellation", input: [3], outerClassification: "R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED", innerClassification: null, childExitCode: 1 },
  ];
  for (const scenario of scenarios) {
    const resultPath = path.join(temp, `${scenario.name}-metadata-preparation-terminal-result.json`);
    const childProgram = `
    import { EventEmitter } from "node:events";
    import { createMetadataPreparationTerminalResult, readHiddenCloudflareAccountId, writeMetadataPreparationTerminalResult } from ${JSON.stringify(runnerUrl)};
    const input = new EventEmitter();
    input.isTTY = true;
    let interval = null;
    let paused = 0;
    input.setRawMode = () => {};
    input.resume = () => { interval = setInterval(() => {}, 25); };
    input.pause = () => { paused += 1; clearInterval(interval); interval = null; };
    const output = { isTTY: true, write: () => {} };
    const account = readHiddenCloudflareAccountId({ input, output });
    process.nextTick(() => input.emit("data", Buffer.from(${JSON.stringify(scenario.input)})));
    let rejected = false;
    try { await account; } catch { rejected = true; }
    if (${scenario.name === "prompt-cancellation"} !== rejected) throw new Error("R6_METADATA_PROMPT_OUTCOME_MISMATCH");
    if (paused !== 1 || interval !== null) throw new Error("R6_METADATA_STDIN_NOT_QUIESCENT");
    const result = createMetadataPreparationTerminalResult({
      terminalResultPath: ${JSON.stringify(resultPath)},
      toolingCommit: ${JSON.stringify(toolingCommit)},
      outerClassification: ${JSON.stringify(scenario.outerClassification)},
      innerClassification: ${JSON.stringify(scenario.innerClassification)},
      childExitCode: ${scenario.childExitCode},
      promptReached: true,
      requestSentinelReached: ${scenario.name !== "prompt-cancellation"},
      transportReached: ${scenario.name !== "prompt-cancellation"},
    });
    await writeMetadataPreparationTerminalResult(result, ${JSON.stringify(resultPath)});
    process.exitCode = ${scenario.childExitCode};
  `;
    const child = await runChild(childProgram);
    assert.equal(child.code, scenario.childExitCode, `${scenario.name} must exit with the terminal status: ${child.stderr}`);
    assert.equal(child.signal, null, `${scenario.name} must quiesce rather than time out or be killed`);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(validateMetadataPreparationTerminalResult(result, { resultPath, toolingCommit }).childExitCode, scenario.childExitCode);
    assert.equal(result.innerClassification, scenario.innerClassification);
  }
  console.log("R6_METADATA_POST_RESULT_EXIT_OK terminal results were persisted and bounded success, aliases-null failure, and prompt cancellation children exited without a live stdin handle");
} finally {
  await rm(temp, { recursive: true, force: true });
}
