import { createHash } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import {
  getWranglerStatePaths,
  PagesAccountIdResolverError,
  resolvePagesAccountId,
} from "./cloudflare-pages-account-resolver.mjs";

export const PAGES_DEPLOYMENT_GET_PARSER_VERSION = "cloudflare-pages-deployment-get-v1";
export const PAGES_DEPLOYMENT_GET_TRANSPORT_VERSION = "cloudflare-pages-deployment-get-v1";
export const PAGES_DEPLOYMENT_GET_EVIDENCE_TYPE = "CLOUDFLARE_PAGES_DEPLOYMENT_GET_V1";
export const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
export const CLOUDFLARE_API_PREFIX = "/client/v4";
export const PAGES_PROJECT = "openglasshub";
export const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9._~-]+$/;
const AUTH_ENVIRONMENT_NAMES = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_API_USER_SERVICE_KEY",
];

export class PagesDeploymentGetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new PagesDeploymentGetError(code); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string" && value.length > 0 ? value : null;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function required(record, key) {
  if (!own(record, key)) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING");
  if (record[key] === null) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
  return record[key];
}

function requiredString(record, key) {
  const value = required(record, key);
  if (!string(value)) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID");
  return value;
}

function requiredObject(record, key) {
  const value = required(record, key);
  if (!object(value)) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID");
  return value;
}

function requiredArray(record, key) {
  const value = required(record, key);
  if (!Array.isArray(value)) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID");
  return value;
}

function decode(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (raw.length === 0 || raw.length > MAX_RESPONSE_BYTES) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID"); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { return JSON.parse(text); }
  catch { fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID"); }
}

function normalizeImmutableUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("PAGES_DEPLOYMENT_GET_TARGET_MISMATCH"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[0-9a-f-]+\.openglasshub\.pages\.dev$/.test(url.hostname)) {
    fail("PAGES_DEPLOYMENT_GET_TARGET_MISMATCH");
  }
  return url.toString();
}

function normalizeDeployment(result) {
  if (!object(result)) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  const id = requiredString(result, "id").toLowerCase();
  const projectName = requiredString(result, "project_name");
  const environment = requiredString(result, "environment");
  const immutableDeploymentUrl = normalizeImmutableUrl(requiredString(result, "url"));
  const aliases = requiredArray(result, "aliases");
  if (!aliases.every((alias) => typeof alias === "string")) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID");
  const trigger = requiredObject(result, "deployment_trigger");
  const metadata = requiredObject(trigger, "metadata");
  const branch = requiredString(metadata, "branch");
  const commitHash = requiredString(metadata, "commit_hash");
  const latestStage = requiredObject(result, "latest_stage");
  const stageName = requiredString(latestStage, "name");
  const stageStatus = requiredString(latestStage, "status");
  const isSkipped = required(result, "is_skipped");
  if (typeof isSkipped !== "boolean") fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID");
  if (!UUID.test(id)) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  return { id, projectName, environment, immutableDeploymentUrl, aliases: [...new Set(aliases)], branch, commitHash, stageName, stageStatus, isSkipped };
}

/** Parses the official Cloudflare envelope once and validates only the minimum sufficient evidence fields. */
export function parsePagesDeploymentGet(rawBytes) {
  const envelope = decode(rawBytes);
  if (!object(envelope)) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  if (envelope.success !== true) fail("PAGES_DEPLOYMENT_GET_API_ERROR");
  if (own(envelope, "errors") && (!Array.isArray(envelope.errors) || envelope.errors.length !== 0)) fail("PAGES_DEPLOYMENT_GET_API_ERROR");
  if (own(envelope, "messages") && !Array.isArray(envelope.messages)) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  if (!own(envelope, "result")) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING");
  if (envelope.result === null) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
  const deployment = normalizeDeployment(envelope.result);
  return { parserVersion: PAGES_DEPLOYMENT_GET_PARSER_VERSION, rawResponseSha256: sha256(rawBytes), deployment };
}

/** The source-proven success policy is the exact Pages stage pair deploy/success. */
export function selectExactProductionDeployment(parsed, expected = {}) {
  if (!object(parsed) || !object(parsed.deployment)) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  const deployment = parsed.deployment;
  if (!UUID.test(String(expected.deploymentId ?? "").toLowerCase())) fail("PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING");
  if (!COMMIT.test(String(expected.sourceCommit ?? ""))) fail("PAGES_DEPLOYMENT_GET_COMMIT_INVALID");
  if (deployment.id !== String(expected.deploymentId).toLowerCase()) fail("PAGES_DEPLOYMENT_GET_DEPLOYMENT_ID_MISMATCH");
  if (deployment.projectName !== PAGES_PROJECT) fail("PAGES_DEPLOYMENT_GET_PROJECT_MISMATCH");
  if (deployment.environment !== "production") fail("PAGES_DEPLOYMENT_GET_ENVIRONMENT_MISMATCH");
  if (!deployment.aliases.includes(CANONICAL_PRODUCTION_URL)) fail("PAGES_DEPLOYMENT_GET_ALIAS_MISMATCH");
  if (deployment.branch !== "main") fail("PAGES_DEPLOYMENT_GET_BRANCH_MISMATCH");
  if (!COMMIT.test(deployment.commitHash)) fail("PAGES_DEPLOYMENT_GET_COMMIT_INVALID");
  if (deployment.commitHash !== expected.sourceCommit) fail("PAGES_DEPLOYMENT_GET_COMMIT_MISMATCH");
  if (deployment.isSkipped || deployment.stageName !== "deploy" || deployment.stageStatus !== "success") fail("PAGES_DEPLOYMENT_GET_STATUS_UNACCEPTABLE");
  return {
    classification: "PAGES_DEPLOYMENT_GET_TARGET_VERIFIED",
    parserVersion: PAGES_DEPLOYMENT_GET_PARSER_VERSION,
    transportVersion: PAGES_DEPLOYMENT_GET_TRANSPORT_VERSION,
    rawResponseSha256: parsed.rawResponseSha256,
    deploymentId: deployment.id,
    projectName: deployment.projectName,
    environment: deployment.environment,
    immutableDeploymentUrl: deployment.immutableDeploymentUrl,
    canonicalAlias: CANONICAL_PRODUCTION_URL,
    branch: deployment.branch,
    sourceCommit: deployment.commitHash,
    stage: { name: deployment.stageName, status: deployment.stageStatus },
  };
}

export function sanitizeDeploymentSelection(selection) {
  if (!object(selection) || selection.classification !== "PAGES_DEPLOYMENT_GET_TARGET_VERIFIED") fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  const allowed = ["classification", "parserVersion", "transportVersion", "rawResponseSha256", "deploymentId", "projectName", "environment", "immutableDeploymentUrl", "canonicalAlias", "branch", "sourceCommit", "stage"];
  const safe = Object.fromEntries(allowed.filter((key) => own(selection, key)).map((key) => [key, selection[key]]));
  if (safe.projectName !== PAGES_PROJECT || safe.environment !== "production" || safe.canonicalAlias !== CANONICAL_PRODUCTION_URL || !COMMIT.test(String(safe.sourceCommit ?? ""))) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
  return safe;
}

function structure(value, location = "$", depth = 0, entries = []) {
  if (depth > 3) { entries.push(`${location}: depth-limit`); return entries; }
  if (value === null) { entries.push(`${location}: null`); return entries; }
  if (Array.isArray(value)) {
    entries.push(`${location}: array(length=${value.length})`);
    value.slice(0, 4).forEach((entry, index) => structure(entry, `${location}[${index}]`, depth + 1, entries));
    return entries;
  }
  if (object(value)) {
    const keys = Object.keys(value).sort();
    entries.push(`${location}: object(keys=[${keys.join(",")}])`);
    keys.slice(0, 12).forEach((key) => structure(value[key], `${location}.${key}`, depth + 1, entries));
    return entries;
  }
  entries.push(`${location}: ${typeof value}`);
  return entries;
}

export function pagesDeploymentGetStructuralDiagnostic(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  try { return { parserVersion: PAGES_DEPLOYMENT_GET_PARSER_VERSION, structure: structure(decode(raw)), rawResponseSha256: sha256(raw) }; }
  catch (error) { return { parserVersion: PAGES_DEPLOYMENT_GET_PARSER_VERSION, classification: error.code ?? "PAGES_DEPLOYMENT_GET_RESULT_INVALID", structure: ["$: invalid-json-or-utf8"], rawResponseSha256: sha256(raw) }; }
}

/** The only permitted endpoint constructor. It cannot represent another method, host, path, project, or query. */
export function fixedDeploymentGetRequest({ accountId, deploymentId }) {
  if (!ACCOUNT_ID.test(String(accountId ?? ""))) fail("PAGES_DEPLOYMENT_GET_TARGET_MISMATCH");
  if (!UUID.test(String(deploymentId ?? "").toLowerCase())) fail("PAGES_DEPLOYMENT_GET_DEPLOYMENT_ID_MISMATCH");
  const endpoint = new URL(`${CLOUDFLARE_API_PREFIX}/accounts/${accountId}/pages/projects/${PAGES_PROJECT}/deployments/${String(deploymentId).toLowerCase()}`, CLOUDFLARE_API_ORIGIN);
  return Object.freeze({ method: "GET", url: endpoint.toString(), redirect: "error", timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES });
}

async function readRegularFile(candidate, readFileImpl) {
  try {
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
    return await readFileImpl(candidate, "utf8");
  } catch (error) {
    if (error instanceof PagesDeploymentGetError) throw error;
    fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  }
}

/** Reads only the Wrangler default OAuth credential. OAuth secret material is never an account-ID source. */
export async function readExistingWranglerOAuthProfile({ home, appData, readFileImpl = readFile } = {}) {
  const paths = await getWranglerStatePaths({ home, appData });
  if (!paths) fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  const authText = await readRegularFile(paths.oauthProfile, readFileImpl);
  const tokenMatch = /^oauth_token\s*=\s*"([A-Za-z0-9._~-]+)"\s*$/m.exec(authText);
  const expiryMatch = /^expiration_time\s*=\s*"([^"\r\n]+)"\s*$/m.exec(authText);
  if (!tokenMatch || !TOKEN.test(tokenMatch[1]) || !expiryMatch || !Number.isFinite(Date.parse(expiryMatch[1])) || Date.parse(expiryMatch[1]) <= Date.now()) fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  return { token: tokenMatch[1] };
}

/** Resolves account routing separately from OAuth and never requires wrangler-account.json when another trusted source exists. */
export async function readExistingWranglerAuth({ repositoryRoot = process.cwd(), home, appData, requestHiddenInput, suppliedHiddenInput, readFileImpl = readFile } = {}) {
  let account;
  try {
    account = await resolvePagesAccountId({ repositoryRoot, home, appData, requestHiddenInput, suppliedHiddenInput, readFileImpl });
  } catch (error) {
    if (error instanceof PagesAccountIdResolverError) fail(error.code);
    throw error;
  }
  const profile = await readExistingWranglerOAuthProfile({ home, appData, readFileImpl });
  return { accountId: account.accountId, token: profile.token, accountResolution: account.classification };
}

export function clearCloudflareAuthEnvironment(env = process.env) {
  for (const name of AUTH_ENVIRONMENT_NAMES) delete env[name];
}

/** Executes exactly one authenticated GET when a future approval supplies the native fetch implementation. */
export async function executeFixedDeploymentGet({ deploymentId, fetchImpl = globalThis.fetch, auth = null, accountId = null, environment = process.env } = {}) {
  if (typeof fetchImpl !== "function") fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  if (AUTH_ENVIRONMENT_NAMES.some((name) => environment[name])) fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  let credentials = auth;
  try {
    credentials ??= await readExistingWranglerAuth();
    const resolvedAccountId = accountId ?? credentials.accountId;
    const request = fixedDeploymentGetRequest({ accountId: resolvedAccountId, deploymentId });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response;
    try {
      response = await fetchImpl(request.url, { method: request.method, redirect: request.redirect, signal: controller.signal, headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json" } });
    } catch { fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
    if (response.redirected || new URL(response.url || request.url).origin !== CLOUDFLARE_API_ORIGIN) fail("PAGES_DEPLOYMENT_GET_TARGET_MISMATCH");
    if (response.status === 401 || response.status === 403) fail("PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE");
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > request.maxResponseBytes) fail("PAGES_DEPLOYMENT_GET_RESULT_INVALID");
    return { request: { method: request.method, endpointSha256: sha256(request.url), accountIdSha256: sha256(resolvedAccountId) }, raw };
  } finally {
    clearCloudflareAuthEnvironment(environment);
    credentials = null;
  }
}

/** Processes an ephemeral raw file and removes it after either parsing or producing a value-free diagnostic. */
export async function processEphemeralDeploymentResponse(rawPath) {
  let raw;
  try {
    raw = await readFile(rawPath);
    try { return { classification: "PAGES_DEPLOYMENT_GET_PARSE_OK", parsed: parsePagesDeploymentGet(raw) }; }
    catch (error) { return { classification: error.code ?? "PAGES_DEPLOYMENT_GET_RESULT_INVALID", diagnostic: pagesDeploymentGetStructuralDiagnostic(raw) }; }
  } finally {
    await rm(rawPath, { force: true });
  }
}
