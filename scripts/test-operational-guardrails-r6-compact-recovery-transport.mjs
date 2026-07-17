import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { RECOVERY_TRANSPORT_MAX_BYTES, readRecoveryConnectorResponse } from "./capture-operational-guardrails-r6-compact-recovery.mjs";
import { baselineRows, createRecoveryPacket } from "../tests/fixtures/operational-guardrails-r6-compact-recovery.mjs";
import { wrapRowsInExactEnvelope } from "../tests/fixtures/operational-guardrails-r6-exact-envelope.mjs";

const harness = path.join(process.cwd(), "scripts", "run-operational-guardrails-r6-compact-recovery-transport.mjs");
const packet = createRecoveryPacket();
const baselineDocument = `${JSON.stringify({ capture_version: "r6-schema-aware-capture-v1", kind: "preflight", rows: baselineRows.map(([check_id, actual_value_redacted], index) => ({ packet_version: "r6-single-result-preflight-v3", phase: "R6-2", section_order: "1", check_order: String(index + 1), check_id, object_identity: "public.forum_upload_attempts", expected_value: "redacted", actual_value_redacted, status: "PASS", blocking: "false", classification: "FUNCTION_ABSENT_SAFE_TO_CREATE", evidence_fingerprint: createHash("md5").update(check_id).digest("hex") })) })}\n`;
const baselineHash = createHash("sha256").update(baselineDocument).digest("hex");
const rawEnvelope = Buffer.from(JSON.stringify(wrapRowsInExactEnvelope([packet])), "utf8");
const secretMarker = "SYNTHETIC-RAW-TRANSPORT-MARKER-NEVER-PERSIST";

function failureTransportPaths(root) {
  const outputPath = path.join(root, "success.json");
  return {
    outputPath,
    outputShaPath: outputPath.replace(/\.json$/, ".sha256"),
    structurePath: outputPath.replace(/\.json$/, "-structure.json"),
    failurePath: path.join(root, "failure.json"),
    failureShaPath: path.join(root, "failure.sha256"),
  };
}

async function assertMissing(target) {
  await assert.rejects(() => access(target));
}

async function runHarness({ root, chunks, timeoutMs } = {}) {
  const baselinePath = path.join(root, "baseline.json");
  await writeFile(baselinePath, baselineDocument, "utf8");
  const paths = failureTransportPaths(root);
  const args = [
    harness,
    "--output", paths.outputPath,
    "--baseline", baselinePath,
    "--baseline-sha256", baselineHash,
    "--failure-output", paths.failurePath,
    "--failure-sha-output", paths.failureShaPath,
  ];
  if (timeoutMs) args.push("--timeout-ms", String(timeoutMs));
  const child = spawn(process.execPath, args, { cwd: process.cwd(), shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (value) => stdout.push(value));
  child.stderr.on("data", (value) => stderr.push(value));
  for (const chunk of chunks) {
    if (!child.stdin.write(chunk)) await new Promise((resolve) => child.stdin.once("drain", resolve));
  }
  child.stdin.end();
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (closeCode, closeSignal) => resolve([closeCode, closeSignal]));
  });
  return { code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), paths };
}

async function assertFailure(name, chunks, classification) {
  const root = await mkdtemp(path.join(os.tmpdir(), `openglass r6 transport ${name} `));
  const result = await runHarness({ root, chunks });
  assert.notEqual(result.code, 0, `${name}: expected failure`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(classification));
  const failure = await readFile(result.paths.failurePath, "utf8");
  const failureSha = await readFile(result.paths.failureShaPath, "utf8");
  assert.equal(JSON.parse(failure).classification, classification);
  assert.equal(failureSha, `${createHash("sha256").update(failure).digest("hex")}  failure.json\n`);
  assert.doesNotMatch(`${failure}\n${result.stdout}\n${result.stderr}`, new RegExp(secretMarker));
  await assertMissing(result.paths.outputPath);
  await assertMissing(result.paths.outputShaPath);
  await assertMissing(result.paths.structurePath);
}

const successRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 transport path with spaces "));
const success = await runHarness({ root: successRoot, chunks: [rawEnvelope] });
assert.equal(success.code, 0, success.stderr);
assert.match(success.stdout, /"status":"PASS"/);
await access(success.paths.outputPath);
await access(success.paths.outputShaPath);
await access(success.paths.structurePath);
await assertMissing(success.paths.failurePath);
await assertMissing(success.paths.failureShaPath);

const multibyte = Buffer.from('{"transport_probe":"😀"}', "utf8");
const emojiOffset = multibyte.indexOf(Buffer.from("😀", "utf8"));
const multibyteParsed = await readRecoveryConnectorResponse(Readable.from([multibyte.subarray(0, emojiOffset + 2), multibyte.subarray(emojiOffset + 2)]));
assert.equal(multibyteParsed.connectorResponse.transport_probe, "😀");
assert.equal(multibyteParsed.transport.chunk_count, 2);

const chunkRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 many chunks "));
const chunks = Array.from({ length: rawEnvelope.byteLength }, (_, index) => rawEnvelope.subarray(index, index + 1));
const chunked = await runHarness({ root: chunkRoot, chunks });
assert.equal(chunked.code, 0, chunked.stderr);
assert.match(chunked.stdout, /"status":"PASS"/);

const crlfRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 crlf "));
const crlf = await runHarness({ root: crlfRoot, chunks: [Buffer.concat([Buffer.from("\r\n", "utf8"), rawEnvelope, Buffer.from("\r\n", "utf8")])] });
assert.equal(crlf.code, 0, crlf.stderr);

const largeRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 large input "));
const large = await runHarness({ root: largeRoot, chunks: [Buffer.concat([Buffer.alloc(RECOVERY_TRANSPORT_MAX_BYTES - rawEnvelope.byteLength - 8, 0x20), rawEnvelope, Buffer.from("\r\n", "utf8")])] });
assert.equal(large.code, 0, large.stderr);
assert.match(large.stdout, /"status":"PASS"/);

await assertFailure("empty", [], "RECOVERY_TRANSPORT_EMPTY_INPUT");
await assertFailure("whitespace", [Buffer.from(" \r\n\t", "utf8")], "RECOVERY_TRANSPORT_WHITESPACE_ONLY");
for (const fraction of [0.25, 0.5]) await assertFailure(`truncated-${fraction}`, [rawEnvelope.subarray(0, Math.floor(rawEnvelope.byteLength * fraction))], "RECOVERY_TRANSPORT_TRUNCATED_JSON");
await assertFailure("truncated-final-byte", [rawEnvelope.subarray(0, -1)], "RECOVERY_TRANSPORT_TRUNCATED_JSON");
await assertFailure("invalid-utf8", [Buffer.from([0xc3, 0x28])], "RECOVERY_TRANSPORT_INVALID_UTF8");
await assertFailure("bom", [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), rawEnvelope])], "RECOVERY_TRANSPORT_PARSE_FAILED");
await assertFailure("malformed", [Buffer.from(`{${secretMarker}`, "utf8")], "RECOVERY_TRANSPORT_PARSE_FAILED");
await assertFailure("two-payloads", [Buffer.concat([rawEnvelope, rawEnvelope])], "RECOVERY_TRANSPORT_PARSE_FAILED");
await assertFailure("oversized", [Buffer.alloc(RECOVERY_TRANSPORT_MAX_BYTES + 1, 0x61)], "RECOVERY_TRANSPORT_OVERSIZED_INPUT");

const collisionRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 collision "));
const collisionPaths = failureTransportPaths(collisionRoot);
await writeFile(collisionPaths.failurePath, "preexisting-safe-marker\n", "utf8");
const collision = await runHarness({ root: collisionRoot, chunks: [rawEnvelope] });
assert.notEqual(collision.code, 0);
assert.match(`${collision.stdout}\n${collision.stderr}`, /RECOVERY_CAPTURE_OUTPUT_EXISTS/);
assert.equal(await readFile(collisionPaths.failurePath, "utf8"), "preexisting-safe-marker\n");
await assertMissing(collisionPaths.outputPath);

const harnessSource = await readFile(harness, "utf8");
assert.match(harnessSource, /shell: false/);
assert.doesNotMatch(harnessSource, /process\.env\s*=|env:\s*\{/);
assert.doesNotMatch(harnessSource, /rawEnvelope|connectorResponse/);
assert.match(harnessSource, /child\.stdin\.end\(\)/);
assert.match(harnessSource, /Promise\.race\(\[once\(child\.stdin, "drain"\), stdinError\]\)/);
console.log(JSON.stringify({ status: "PASS", accepted: 4, rejected: 12, exactFailurePairs: 11, staleFailureRejected: true, rawInputPersisted: false, shellFree: true, stdinOnly: true }));
