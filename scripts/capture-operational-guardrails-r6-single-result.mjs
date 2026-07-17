import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { CAPTURE_VERSION, OUTPUT_COLUMNS, parsePacketDocument, validateRows } from "./validate-operational-guardrails-r6-single-result.mjs";

const safeError = (code) => new Error(code);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const credentialLike = (value) => [
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /\b(?:postgres|postgresql):\/\/[^\s]+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/i,
  /\b(?:sbp_|supabase_[a-z_]*key[_-]?[A-Za-z0-9_-]{20,}|service[_-]?role(?:[_-]?key)?[_-][A-Za-z0-9_-]{20,})/i,
  /\b(?:cookie|authorization)\s*[:=]/i,
  /(?:[?&](?:token|access_token|signature|x-amz-signature)=)/i,
  /\b(?:password|pwd)\s*=/i,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
].some((pattern) => pattern.test(value));

export function extractConnectorPacket(connectorResponse) {
  if (!connectorResponse || connectorResponse.isError === true || !Array.isArray(connectorResponse.content)) throw safeError("CAPTURE_REJECTED_CONNECTOR_RESPONSE");
  if (connectorResponse.content.length !== 1 || connectorResponse.content[0]?.type !== "text" || typeof connectorResponse.content[0]?.text !== "string") throw safeError("CAPTURE_REJECTED_MULTIPLE_OR_MALFORMED_RESULT_SETS");
  let rows;
  try {
    rows = JSON.parse(connectorResponse.content[0].text);
  } catch {
    throw safeError("CAPTURE_REJECTED_INVALID_CONNECTOR_JSON");
  }
  if (!Array.isArray(rows) || rows.some((row) => !exactKeys(row, OUTPUT_COLUMNS))) throw safeError("CAPTURE_REJECTED_PACKET_SCHEMA");
  for (const row of rows) {
    if (Object.values(row).some((value) => typeof value !== "string")) throw safeError("CAPTURE_REJECTED_PACKET_VALUE_TYPE");
    if (Object.values(row).some((value) => credentialLike(value))) throw safeError("CAPTURE_REJECTED_SENSITIVE_CONTENT");
  }
  return rows.map((row) => Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, row[column]])));
}

export function canonicalizeConnectorPacket(kind, connectorResponse, expectedTargetMarker) {
  const rows = extractConnectorPacket(connectorResponse);
  const result = validateRows(kind, rows, { expectedTargetMarker });
  return { document: { capture_version: CAPTURE_VERSION, kind, rows }, ...result };
}

async function writeAtomic(targetPath, contents) {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, targetPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function requireUnused(targetPath) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw safeError("CAPTURE_REJECTED_OUTPUT_PATH_EXISTS");
}

export async function verifyPersistedPacket({ kind, outputPath, expectedTargetMarker }) {
  const sidecarPath = outputPath.replace(/\.json$/i, ".sha256");
  const [contents, sidecar] = await Promise.all([readFile(outputPath, "utf8"), readFile(sidecarPath, "utf8")]);
  const evidenceHash = sha256(contents);
  if (sidecar !== `${evidenceHash}  ${path.basename(outputPath)}\n`) throw safeError("EVIDENCE_SHA_MISMATCH");
  const rows = parsePacketDocument(contents);
  const result = validateRows(kind, rows, { expectedTargetMarker });
  return { ...result, outputPath, sidecarPath, evidenceHash, rowCount: rows.length };
}

export async function persistCanonicalPacket({ kind, connectorResponse, expectedTargetMarker, outputPath }) {
  let canonical;
  try {
    canonical = canonicalizeConnectorPacket(kind, connectorResponse, expectedTargetMarker);
  } catch (error) {
    await writeAtomic(`${outputPath}.capture-error.json`, `${JSON.stringify({ capture_version: CAPTURE_VERSION, classification: error.message }, null, 2)}\n`);
    throw error;
  }
  const serialized = `${JSON.stringify(canonical.document, null, 2)}\n`;
  const evidenceHash = sha256(serialized);
  const sidecarPath = outputPath.replace(/\.json$/i, ".sha256");
  let wroteOutput = false;
  let wroteSidecar = false;
  try {
    await Promise.all([requireUnused(outputPath), requireUnused(sidecarPath)]);
    await writeAtomic(outputPath, serialized);
    wroteOutput = true;
    await writeAtomic(sidecarPath, `${evidenceHash}  ${path.basename(outputPath)}\n`);
    wroteSidecar = true;
    return await verifyPersistedPacket({ kind, outputPath, expectedTargetMarker });
  } catch (error) {
    await Promise.all([wroteOutput ? rm(outputPath, { force: true }) : undefined, wroteSidecar ? rm(sidecarPath, { force: true }) : undefined]);
    throw error;
  }
}

const [kind, outputPath, expectedTargetMarker, encodedResponse] = process.argv.slice(2);
if (kind && outputPath && expectedTargetMarker && encodedResponse) {
  try {
    const connectorResponse = JSON.parse(Buffer.from(encodedResponse, "base64url").toString("utf8"));
    const result = await persistCanonicalPacket({ kind, connectorResponse, expectedTargetMarker, outputPath });
    console.log(JSON.stringify({ status: "PASS", kind, classification: result.classification, rowCount: result.rowCount, evidenceHash: result.evidenceHash }));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", classification: error.message }));
    process.exitCode = 1;
  }
}
