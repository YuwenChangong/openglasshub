import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";

export const WRANGLER_PAGES_DEPLOYMENT_JSON_PARSER_VERSION = "wrangler-pages-deployments-v1";
export const WRANGLER_PAGES_DEPLOYMENT_SELECTOR_VERSION = "wrangler-pages-deployments-selector-v1";

export class WranglerPagesDeploymentJsonError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new WranglerPagesDeploymentJsonError(code); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;

function decodeJson(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { fail("WRANGLER_JSON_UNSUPPORTED_SHAPE"); }
  if (decoded.charCodeAt(0) === 0xfeff) decoded = decoded.slice(1);
  if (decoded.trim().length === 0) fail("WRANGLER_JSON_UNSUPPORTED_SHAPE");
  try { return JSON.parse(decoded); } catch { fail("WRANGLER_JSON_UNSUPPORTED_SHAPE"); }
}

function requiredString(record, key) {
  const value = text(record[key]);
  if (!value) fail("WRANGLER_JSON_REQUIRED_FIELD_MISSING");
  return value;
}

function normalizeRecord(record) {
  if (!isObject(record)) fail("WRANGLER_JSON_MALFORMED_RECORD");
  const id = requiredString(record, "Id");
  const environment = requiredString(record, "Environment");
  const branch = requiredString(record, "Branch");
  const source = requiredString(record, "Source");
  const deployment = requiredString(record, "Deployment");
  const status = requiredString(record, "Status");
  const build = requiredString(record, "Build");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{7}$/i.test(source)) fail("WRANGLER_JSON_MALFORMED_RECORD");
  if (!["Production", "Preview"].includes(environment)) fail("WRANGLER_JSON_MALFORMED_RECORD");
  let immutable;
  try { immutable = new URL(deployment); } catch { fail("WRANGLER_JSON_MALFORMED_RECORD"); }
  if (immutable.protocol !== "https:" || immutable.username || immutable.password || immutable.port || immutable.pathname !== "/") fail("WRANGLER_JSON_MALFORMED_RECORD");
  let buildUrl;
  try { buildUrl = new URL(build); } catch { fail("WRANGLER_JSON_MALFORMED_RECORD"); }
  if (buildUrl.protocol !== "https:" || buildUrl.hostname !== "dash.cloudflare.com") fail("WRANGLER_JSON_MALFORMED_RECORD");
  return { id: id.toLowerCase(), environment, branch, source: source.toLowerCase(), immutableDeploymentUrl: immutable.toString(), status };
}

/**
 * Parses only Wrangler 4.106.0's documented implementation shape: an array of
 * table projection records with title-cased property names. It never accepts an
 * API envelope because the CLI serializes the projection, not the API response.
 */
export function parseWranglerPagesDeployments(rawBytes) {
  const parsed = decodeJson(rawBytes);
  if (parsed === null) fail("WRANGLER_JSON_TOP_LEVEL_NULL");
  if (!Array.isArray(parsed)) fail("WRANGLER_JSON_UNSUPPORTED_SHAPE");
  if (parsed.length === 0) fail("WRANGLER_JSON_EMPTY_RESULT");
  const ids = new Set();
  const deployments = parsed.map(normalizeRecord);
  for (const deployment of deployments) {
    if (ids.has(deployment.id)) fail("WRANGLER_JSON_DUPLICATE_DEPLOYMENT_ID");
    ids.add(deployment.id);
  }
  return { parserVersion: WRANGLER_PAGES_DEPLOYMENT_JSON_PARSER_VERSION, sourceOutputSha256: sha256(rawBytes), deployments };
}

/**
 * A Pages list projection cannot attest a deployed commit: Wrangler emits only
 * a seven-character Source field, a human-formatted Status, and no aliases.
 */
export function selectAttestableProductionDeployment(parsed, expected = {}) {
  if (!parsed || !Array.isArray(parsed.deployments)) fail("WRANGLER_JSON_UNSUPPORTED_SHAPE");
  if (expected.projectName !== "openglasshub" || expected.environment !== "production" || expected.canonicalBaseUrl !== "https://openglasshub.pages.dev" || !/^[0-9a-f]{40}$/.test(String(expected.sourceCommit ?? ""))) {
    fail("WRANGLER_JSON_REQUIRED_FIELD_MISSING");
  }
  // These three facts are deliberately unavailable in the 4.106.0 projection.
  // Refusing here prevents a short Source prefix, display Status, or URL from
  // becoming a substitute for the full active-production identity.
  for (const deployment of parsed.deployments) {
    if (deployment.environment === "Production" && deployment.branch === "main" && deployment.immutableDeploymentUrl.endsWith(".openglasshub.pages.dev/")) {
      fail("WRANGLER_JSON_REQUIRED_FIELD_MISSING");
    }
  }
  fail("WRANGLER_JSON_DEPLOYMENT_NOT_FOUND");
}

export function sanitizeAttestableDeployment(selection) {
  if (!isObject(selection)) fail("WRANGLER_JSON_REQUIRED_FIELD_MISSING");
  const allowed = ["deploymentId", "environment", "immutableDeploymentUrl", "canonicalAliases", "branch", "sourceCommit", "stageStatus", "createdAt", "modifiedAt", "sourceOutputSha256", "parserVersion", "selectorVersion"];
  const sanitized = {};
  for (const key of allowed) if (Object.hasOwn(selection, key)) sanitized[key] = selection[key];
  if (!Array.isArray(sanitized.canonicalAliases) || !sanitized.canonicalAliases.includes("https://openglasshub.pages.dev") || !/^[0-9a-f]{40}$/.test(String(sanitized.sourceCommit ?? ""))) {
    fail("WRANGLER_JSON_REQUIRED_FIELD_MISSING");
  }
  return sanitized;
}

function shape(value, path = "$", depth = 0, output = []) {
  if (depth > 3) { output.push(`${path}: depth-limit`); return output; }
  if (value === null) { output.push(`${path}: null`); return output; }
  if (Array.isArray(value)) {
    output.push(`${path}: array(length=${value.length})`);
    value.slice(0, 4).forEach((entry, index) => shape(entry, `${path}[${index}]`, depth + 1, output));
    return output;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    output.push(`${path}: object(keys=[${keys.join(",")}])`);
    keys.slice(0, 12).forEach((key) => shape(value[key], `${path}.${key}`, depth + 1, output));
    return output;
  }
  output.push(`${path}: ${typeof value}`);
  return output;
}

export function structuralDiagnostic(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  let value;
  try { value = decodeJson(raw); } catch (error) { return { parserVersion: WRANGLER_PAGES_DEPLOYMENT_JSON_PARSER_VERSION, classification: error.code ?? "WRANGLER_JSON_UNSUPPORTED_SHAPE", structure: ["$: non-json-or-invalid-utf8"], sourceOutputSha256: sha256(raw) }; }
  return { parserVersion: WRANGLER_PAGES_DEPLOYMENT_JSON_PARSER_VERSION, classification: "WRANGLER_JSON_PARSE_OK", structure: shape(value), sourceOutputSha256: sha256(raw) };
}

/** Reads raw stdout once, returns only safe output, and removes the raw file on all paths. */
export async function processEphemeralWranglerOutput(rawPath) {
  let raw;
  try {
    raw = await readFile(rawPath);
    try { return { classification: "WRANGLER_JSON_PARSE_OK", parsed: parseWranglerPagesDeployments(raw) }; }
    catch (error) { return { classification: error.code ?? "WRANGLER_JSON_UNSUPPORTED_SHAPE", diagnostic: structuralDiagnostic(raw) }; }
  } finally {
    await rm(rawPath, { force: true });
  }
}

/** Keeps stderr out of parser input while retaining only a digest for evidence. */
export function processWranglerCommandCapture({ exitCode, stdout, stderr = Buffer.alloc(0) }) {
  const stdoutBytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const stderrBytes = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr);
  const capture = { stdoutSha256: sha256(stdoutBytes), stderrSha256: sha256(stderrBytes), stderrByteCount: stderrBytes.length };
  if (exitCode !== 0) return { classification: "WRANGLER_JSON_UNSUPPORTED_SHAPE", capture, diagnostic: structuralDiagnostic(stdoutBytes) };
  try { return { classification: "WRANGLER_JSON_PARSE_OK", capture, parsed: parseWranglerPagesDeployments(stdoutBytes) }; }
  catch (error) { return { classification: error.code ?? "WRANGLER_JSON_UNSUPPORTED_SHAPE", capture, diagnostic: structuralDiagnostic(stdoutBytes) }; }
}
