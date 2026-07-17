import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureEnvelopeStructureFromObject, BRIDGE_VERSION } from "./capture-operational-guardrails-r6-envelope-structure.mjs";
import { OUTPUT_COLUMNS } from "./validate-operational-guardrails-r6-single-result.mjs";
import { PROBE_MARKER } from "./record-operational-guardrails-r6-envelope-structure.mjs";
import { wrapRowsInExactEnvelope } from "../tests/fixtures/operational-guardrails-r6-exact-envelope.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgePath = path.join(root, "scripts", "capture-operational-guardrails-r6-envelope-structure.mjs");
const recorderPath = path.join(root, "scripts", "record-operational-guardrails-r6-envelope-structure.mjs");

const row = (order, role, label = "synthetic.expected") => Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, {
  packet_version: PROBE_MARKER,
  phase: "PREFLIGHT",
  section_order: 1,
  check_order: order,
  check_id: `probe_row_${order}`,
  object_identity: "synthetic.object",
  expected_value: label,
  actual_value_redacted: role,
  status: "PASS",
  blocking: false,
  classification: "PROBE_ONLY",
  evidence_fingerprint: String.fromCharCode(96 + order).repeat(64),
}[column]]));

const rows = [
  row(1, "service_role"),
  row(2, "authenticated", "UTF-8: 圈子🌐"),
];

const direct = { isError: false, content: [{ type: "text", text: JSON.stringify(rows) }] };
const nested = { isError: false, content: [{ type: "text", text: JSON.stringify({ envelope: { result: rows } }) }] };
const exactConnectorEnvelope = wrapRowsInExactEnvelope(rows);
const structureContains = async (targetPath, pattern) => pattern.test(await readFile(targetPath, "utf8"));
const fileMissing = async (targetPath) => {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  return false;
};

async function requireUnused(targetPath) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("OUTPUT_PATH_EXISTS");
}

async function writeAtomic(targetPath, contents) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, "utf8");
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass r6 bridge "));
const directOutput = path.join(temporaryRoot, "proof with spaces", "direct-structure.json");
const directResult = await captureEnvelopeStructureFromObject({ connectorResponse: nested, outputPath: directOutput });
assert.equal(directResult.status, "PASS");
assert.equal(directResult.bridge_version, BRIDGE_VERSION);
assert.equal(directResult.classification, "ENVELOPE_STRUCTURE_RECORDED");
assert.equal(directResult.candidateCount, 1);
assert.equal(directResult.markerPaths, 2);
assert.match(directResult.outputPath, /proof with spaces/);
assert.equal(directResult.evidenceHash, createHash("sha256").update(await readFile(directOutput, "utf8")).digest("hex"));
assert.equal(await structureContains(directOutput, /"\$\.content\[0\]\.text#json\.envelope\.result"/), true);
assert.equal(await structureContains(directOutput, /"approved_probe_marker": "R6_CONNECTOR_ENVELOPE_PROBE_V1"/), true);
assert.equal(await structureContains(directOutput, /service_role|authenticated|synthetic\.object|UTF-8: 圈子🌐/), false);
assert.deepEqual((await readdir(path.dirname(directOutput))).sort(), ["direct-structure.json", "direct-structure.sha256"]);

const cliOutput = path.join(temporaryRoot, "cli output", "cli-structure.json");
const cli = spawnSync(process.execPath, [bridgePath, cliOutput], {
  cwd: root,
  input: Buffer.from(JSON.stringify(direct), "utf8"),
  encoding: "utf8",
});
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stderr, "");
assert.match(cli.stdout, /"status":"PASS"/);
assert.doesNotMatch(cli.stdout, /service_role|authenticated|synthetic\.object|UTF-8: 圈子🌐/);
assert.equal(await structureContains(cliOutput, /"\$\.content\[0\]\.text#json"/), true);

const wrappedOutput = path.join(temporaryRoot, "wrapped proof", "structure.json");
const wrappedResult = await captureEnvelopeStructureFromObject({ connectorResponse: exactConnectorEnvelope, outputPath: wrappedOutput });
assert.equal(wrappedResult.candidateCount, 1);
assert.equal(await structureContains(wrappedOutput, /"\$\[0\]\.text#json\.result#wrapped_json"/), true);

for (const [name, input, expected] of [
  ["empty input", Buffer.alloc(0), /BRIDGE_REJECTED_EMPTY_INPUT/],
  ["truncated json", Buffer.from('{"isError":false,"content":[', "utf8"), /BRIDGE_REJECTED_INVALID_JSON/],
  ["multiple payloads", Buffer.from(`${JSON.stringify(direct)}${JSON.stringify(direct)}`, "utf8"), /BRIDGE_REJECTED_INVALID_JSON/],
  ["malformed utf8", Buffer.from([0xc3, 0x28]), /BRIDGE_REJECTED_INVALID_UTF8/],
]) {
  const outputPath = path.join(temporaryRoot, `${name.replaceAll(" ", "-")}.json`);
  const failure = spawnSync(process.execPath, [bridgePath, outputPath], { cwd: root, input, encoding: "utf8" });
  assert.equal(failure.status, 1, name);
  assert.match(failure.stderr, expected, name);
  assert.equal(await fileMissing(outputPath), true, `${name} output must not exist`);
  assert.equal(await fileMissing(outputPath.replace(/\.json$/i, ".sha256")), true, `${name} sidecar must not exist`);
}

const extraArg = spawnSync(process.execPath, [bridgePath, path.join(temporaryRoot, "extra.json"), "--raw-response-not-allowed"], {
  cwd: root,
  input: Buffer.from(JSON.stringify(direct), "utf8"),
  encoding: "utf8",
});
assert.equal(extraArg.status, 1);
assert.match(extraArg.stderr, /BRIDGE_REJECTED_EXTRA_ARGUMENTS/);
assert.doesNotMatch(extraArg.stderr, /synthetic\.object|service_role/);

for (const [name, text] of [
  ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"],
  ["database uri", "postgresql://user:password@db.example/test"],
  ["bearer", "Bearer opaque-token"],
  ["cookie", "cookie=session=opaque"],
  ["signed url", "https://example.test/file?X-Amz-Signature=opaque"],
  ["long credential", "service_role_key_abcdefghijklmnopqrstuvwxyz"],
]) {
  const outputPath = path.join(temporaryRoot, `${name.replaceAll(" ", "-")}.json`);
  const dangerous = { isError: false, content: [{ type: "text", text }] };
  const failure = spawnSync(process.execPath, [bridgePath, outputPath], {
    cwd: root,
    input: Buffer.from(JSON.stringify(dangerous), "utf8"),
    encoding: "utf8",
  });
  assert.equal(failure.status, 1, name);
  assert.match(failure.stderr, /ENVELOPE_STRUCTURE_SENSITIVE_SCALAR/);
  assert.equal(await fileMissing(outputPath), true, `${name} output must not exist`);
  assert.equal(await fileMissing(outputPath.replace(/\.json$/i, ".sha256")), true, `${name} sidecar must not exist`);
  const safeErrorPath = `${outputPath}.capture-error.json`;
  assert.equal(await structureContains(safeErrorPath, /ENVELOPE_STRUCTURE_SENSITIVE_SCALAR/), true);
  assert.equal(await structureContains(safeErrorPath, /opaque-token|db\.example|session=opaque/), false);
}

const partialOutput = path.join(temporaryRoot, "partial write", "structure.json");
await assert.rejects(() => captureEnvelopeStructureFromObject({
  connectorResponse: direct,
  outputPath: partialOutput,
}, {
  readFile,
  removeFile: (targetPath) => rm(targetPath, { force: true }),
  requireUnused,
  writeAtomic: async (targetPath, contents) => {
    await writeAtomic(targetPath, contents);
    if (targetPath.endsWith(".sha256")) throw new Error("SIMULATED_PARTIAL_WRITE");
  },
}), /SIMULATED_PARTIAL_WRITE/);
assert.equal(await fileMissing(partialOutput), true);
assert.equal(await fileMissing(partialOutput.replace(/\.json$/i, ".sha256")), true);

const mismatchOutput = path.join(temporaryRoot, "sha mismatch", "structure.json");
await assert.rejects(() => captureEnvelopeStructureFromObject({
  connectorResponse: direct,
  outputPath: mismatchOutput,
}, {
  readFile: async (targetPath, encoding) => targetPath.endsWith(".sha256")
    ? `${"0".repeat(64)}  ${path.basename(mismatchOutput)}\n`
    : readFile(targetPath, encoding),
  removeFile: (targetPath) => rm(targetPath, { force: true }),
  requireUnused,
  writeAtomic,
}), /ENVELOPE_STRUCTURE_SHA_MISMATCH/);
assert.equal(await fileMissing(mismatchOutput), true);
assert.equal(await fileMissing(mismatchOutput.replace(/\.json$/i, ".sha256")), true);

const [bridgeSource, recorderSource] = await Promise.all([readFile(bridgePath, "utf8"), readFile(recorderPath, "utf8")]);
for (const source of [bridgeSource, recorderSource]) {
  assert.doesNotMatch(source, /\bbtoa\s*\(/);
  assert.doesNotMatch(source, /\batob\s*\(/);
}

console.log(JSON.stringify({
  status: "PASS",
  bridge: true,
  sameProcess: true,
  stdinCli: true,
  malformedCases: 4,
  sensitiveCases: 6,
  partialWriteCleanup: true,
  shaMismatchCleanup: true,
}));
