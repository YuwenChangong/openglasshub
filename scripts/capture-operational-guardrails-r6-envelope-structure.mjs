import { readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { persistConnectorEnvelopeStructure } from "./record-operational-guardrails-r6-envelope-structure.mjs";

export const BRIDGE_VERSION = "r6-node-safe-envelope-bridge-v1";

const safeError = (code) => new Error(code);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function sanitizeSummary(result) {
  return {
    status: "PASS",
    bridge_version: BRIDGE_VERSION,
    classification: "ENVELOPE_STRUCTURE_RECORDED",
    candidateCount: result.packet_candidate_count,
    markerPaths: result.probe_marker_paths.length,
    evidenceHash: result.evidenceHash,
    outputPath: result.outputPath,
    sidecarPath: result.sidecarPath,
  };
}

export function parseConnectorResponseJson(jsonText) {
  if (typeof jsonText !== "string" || jsonText.length === 0) throw safeError("BRIDGE_REJECTED_EMPTY_INPUT");
  if (jsonText.charCodeAt(0) === 0xfeff) throw safeError("BRIDGE_REJECTED_BOM");
  let connectorResponse;
  try {
    connectorResponse = JSON.parse(jsonText);
  } catch {
    throw safeError("BRIDGE_REJECTED_INVALID_JSON");
  }
  if (connectorResponse === null || typeof connectorResponse !== "object") throw safeError("BRIDGE_REJECTED_NON_OBJECT_RESPONSE");
  return connectorResponse;
}

export async function readUtf8Stdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) throw safeError("BRIDGE_REJECTED_EMPTY_INPUT");
  try {
    return UTF8_DECODER.decode(Buffer.concat(chunks));
  } catch {
    throw safeError("BRIDGE_REJECTED_INVALID_UTF8");
  }
}

export async function captureEnvelopeStructureFromObject({ connectorResponse, outputPath }, io) {
  if (!outputPath || typeof outputPath !== "string") throw safeError("BRIDGE_REJECTED_OUTPUT_PATH");
  const result = await persistConnectorEnvelopeStructure({ connectorResponse, outputPath: path.resolve(outputPath) }, io);
  return sanitizeSummary(result);
}

export async function captureEnvelopeStructureFromJson({ jsonText, outputPath }, io) {
  const connectorResponse = parseConnectorResponseJson(jsonText);
  return captureEnvelopeStructureFromObject({ connectorResponse, outputPath }, io);
}

export async function captureEnvelopeStructureFromStdin({ outputPath, stdin = process.stdin } = {}, io) {
  const jsonText = await readUtf8Stdin(stdin);
  return captureEnvelopeStructureFromJson({ jsonText, outputPath }, io);
}

export async function captureEnvelopeStructureFromFile({ inputPath, outputPath }, io) {
  if (!inputPath || typeof inputPath !== "string") throw safeError("BRIDGE_REJECTED_INPUT_PATH");
  const jsonText = await readFile(path.resolve(inputPath), "utf8");
  return captureEnvelopeStructureFromJson({ jsonText, outputPath }, io);
}

const [outputPath, ...unexpectedArgs] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url) && outputPath) {
  try {
    if (unexpectedArgs.length !== 0) throw safeError("BRIDGE_REJECTED_EXTRA_ARGUMENTS");
    const result = await captureEnvelopeStructureFromStdin({ outputPath });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", bridge_version: BRIDGE_VERSION, classification: error.message }));
    process.exitCode = 1;
  }
}
