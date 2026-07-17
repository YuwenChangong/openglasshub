import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECOVERY_TRANSPORT_MAX_BYTES, prepareRecoveryCapture, writeTransportFailureDiagnostic } from "./capture-operational-guardrails-r6-compact-recovery.mjs";

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-operational-guardrails-r6-compact-recovery.mjs");
const MAX_CHILD_OUTPUT_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 15_000;
const safeError = (code) => new Error(code);

function parseOptions(argumentsList) {
  const values = new Map();
  const supported = new Set(["--output", "--baseline", "--baseline-sha256", "--failure-output", "--failure-sha-output", "--timeout-ms"]);
  if (argumentsList.length % 2 !== 0) throw safeError("RECOVERY_TRANSPORT_ARGUMENTS_INVALID");
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!supported.has(key) || values.has(key) || typeof value !== "string" || value.startsWith("--")) throw safeError("RECOVERY_TRANSPORT_ARGUMENTS_INVALID");
    values.set(key, value);
  }
  for (const required of ["--output", "--baseline", "--baseline-sha256"]) if (!values.has(required)) throw safeError("RECOVERY_TRANSPORT_ARGUMENTS_INVALID");
  const timeout = Number(values.get("--timeout-ms") ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) throw safeError("RECOVERY_TRANSPORT_TIMEOUT_INVALID");
  return {
    outputPath: values.get("--output"),
    baselinePath: values.get("--baseline"),
    baselineSha256: values.get("--baseline-sha256"),
    failureOutputPath: values.get("--failure-output"),
    failureShaOutputPath: values.get("--failure-sha-output"),
    timeout,
    runnerArguments: [...values.entries()].filter(([key]) => key !== "--timeout-ms").flat(),
  };
}

function transportMetadata(bytes, chunkCount, overrides = {}) {
  return {
    bytes_received: bytes,
    chunk_count: chunkCount,
    eof_observed: false,
    stdin_ended_normally: false,
    utf8_validation_passed: false,
    input_empty: false,
    input_whitespace_only: false,
    json_parsing_attempted: false,
    json_parsing_succeeded: false,
    parser_error_category: null,
    maximum_allowed_bytes: RECOVERY_TRANSPORT_MAX_BYTES,
    ...overrides,
  };
}

async function readInput(input = process.stdin) {
  const chunks = [];
  let bytes = 0;
  let chunkCount = 0;
  try {
    for await (const chunk of input) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      bytes += value.byteLength;
      chunkCount += 1;
      if (bytes > RECOVERY_TRANSPORT_MAX_BYTES) throw Object.assign(safeError("RECOVERY_TRANSPORT_OVERSIZED_INPUT"), { transport: transportMetadata(bytes, chunkCount) });
      chunks.push(value);
    }
  } catch (error) {
    if (error?.transport) throw error;
    throw Object.assign(safeError("RECOVERY_TRANSPORT_PREMATURE_CLOSE"), { transport: transportMetadata(bytes, chunkCount) });
  }
  return Buffer.concat(chunks);
}

function safeChildResult(stdout, stderr, code, signal) {
  if (stdout.byteLength > MAX_CHILD_OUTPUT_BYTES || stderr.byteLength > MAX_CHILD_OUTPUT_BYTES) throw safeError("RECOVERY_TRANSPORT_CHILD_FAILURE");
  const outputs = [stdout, stderr].filter((value) => value.trim() !== "");
  if (outputs.length !== 1) throw safeError("RECOVERY_TRANSPORT_CHILD_FAILURE");
  let packet;
  try { packet = JSON.parse(outputs[0]); } catch { throw safeError("RECOVERY_TRANSPORT_CHILD_FAILURE"); }
  if (!packet || typeof packet !== "object" || Array.isArray(packet) || !["PASS", "FAIL"].includes(packet.status) || typeof packet.classification !== "string") throw safeError("RECOVERY_TRANSPORT_CHILD_FAILURE");
  return { status: packet.status, classification: packet.classification, exitCode: code, signal };
}

export async function runRecoveryTransport({ input, options, preparedPaths }) {
  const paths = preparedPaths ?? await prepareRecoveryCapture(options);
  let child;
  const stdout = [];
  const stderr = [];
  let timedOut = false;
  let timer;
  try {
    child = spawn(process.execPath, [RUNNER, ...options.runnerArguments], { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const childError = once(child, "error").then(([error]) => { throw Object.assign(safeError("RECOVERY_TRANSPORT_CHILD_FAILURE"), { cause: error }); });
    const stdinError = once(child.stdin, "error").then(([error]) => { throw Object.assign(safeError("RECOVERY_TRANSPORT_CHILD_FAILURE"), { cause: error }); });
    timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout);
    if (!child.stdin.write(input)) await Promise.race([once(child.stdin, "drain"), stdinError]);
    child.stdin.end();
    const [code, signal] = await Promise.race([once(child, "close"), childError, stdinError]);
    if (timedOut) {
      throw Object.assign(safeError("RECOVERY_TRANSPORT_TIMEOUT"), { transport: transportMetadata(input.byteLength, input.byteLength === 0 ? 0 : 1) });
    }
    return safeChildResult(Buffer.concat(stdout).toString("utf8"), Buffer.concat(stderr).toString("utf8"), code, signal);
  } catch (error) {
    const failure = error?.transport ? error : Object.assign(safeError("RECOVERY_TRANSPORT_CHILD_FAILURE"), { transport: transportMetadata(input.byteLength, input.byteLength === 0 ? 0 : 1) });
    await writeTransportFailureDiagnostic(paths, failure.message, failure.transport);
    throw failure;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let paths;
  try {
    const options = parseOptions(process.argv.slice(2));
    paths = await prepareRecoveryCapture(options);
    const input = await readInput();
    const result = await runRecoveryTransport({ input, options, preparedPaths: paths });
    console.log(JSON.stringify(result));
    if (result.status !== "PASS" || result.exitCode !== 0) process.exitCode = 1;
  } catch (error) {
    if (paths && error?.transport) {
      try { await writeTransportFailureDiagnostic(paths, error.message, error.transport); } catch (failureError) { error = failureError; }
    }
    console.error(JSON.stringify({ status: "FAIL", classification: error.message }));
    process.exitCode = 1;
  }
}
