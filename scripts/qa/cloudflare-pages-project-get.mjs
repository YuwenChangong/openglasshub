import { createHash } from "node:crypto";

export const PAGES_PROJECT_GET_PARSER_VERSION = "cloudflare-pages-project-get-v1";
export const PAGES_PROJECT_GET_TRANSPORT_VERSION = "cloudflare-pages-project-get-v1";
export const PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256 = "7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0";
export const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
export const CLOUDFLARE_API_PREFIX = "/client/v4";
export const PAGES_PROJECT = "openglasshub";
export const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15_000;

const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const AUTH_ENVIRONMENT_NAMES = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "CLOUDFLARE_API_USER_SERVICE_KEY"];

export class PagesProjectGetError extends Error {
  constructor(code, diagnostic = {}) {
    super(code);
    this.code = code;
    this.jsonPath = diagnostic.jsonPath ?? null;
    this.observedType = diagnostic.observedType ?? null;
    this.expectedType = diagnostic.expectedType ?? null;
    this.diagnosticReference = this.jsonPath ? `${code}:${this.jsonPath}` : code;
  }
}

const fail = (code, diagnostic) => { throw new PagesProjectGetError(code, diagnostic); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const observedType = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const nonEmptyString = (value) => typeof value === "string" && value.length > 0;

function required(record, key, jsonPath, expectedType) {
  if (!own(record, key)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_MISSING", { jsonPath, observedType: "missing", expectedType });
  if (record[key] === null) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_NULL", { jsonPath, observedType: "null", expectedType });
  return record[key];
}

function requiredObject(record, key, jsonPath) {
  const value = required(record, key, jsonPath, "object");
  if (!object(value)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath, observedType: observedType(value), expectedType: "object" });
  return value;
}

function requiredString(record, key, jsonPath) {
  const value = required(record, key, jsonPath, "non-empty-string");
  if (!nonEmptyString(value)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath, observedType: observedType(value), expectedType: "non-empty-string" });
  return value;
}

function requiredArray(record, key, jsonPath) {
  const value = required(record, key, jsonPath, "array");
  if (!Array.isArray(value)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath, observedType: observedType(value), expectedType: "array" });
  return value;
}

function decode(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  if (raw.length === 0 || raw.length > MAX_RESPONSE_BYTES) fail("PAGES_PROJECT_GET_RESULT_INVALID");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { fail("PAGES_PROJECT_GET_RESULT_INVALID"); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { return JSON.parse(text); }
  catch { fail("PAGES_PROJECT_GET_RESULT_INVALID"); }
}

function normalizedImmutableUrl(value, jsonPath) {
  let url;
  try { url = new URL(value); }
  catch { fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath, observedType: "string", expectedType: "https-immutable-pages-url" }); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[0-9a-f-]+\.openglasshub\.pages\.dev$/.test(url.hostname)) {
    fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath, observedType: "string", expectedType: "https-immutable-pages-url" });
  }
  return url.toString();
}

function normalizeDeployment(record, jsonPath) {
  if (!object(record)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath, observedType: observedType(record), expectedType: "object" });
  const id = requiredString(record, "id", `${jsonPath}.id`).toLowerCase();
  if (!UUID.test(id)) fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath: `${jsonPath}.id`, observedType: "string", expectedType: "uuid" });
  const aliases = requiredArray(record, "aliases", `${jsonPath}.aliases`);
  if (!aliases.every(nonEmptyString)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath: `${jsonPath}.aliases[]`, observedType: "array", expectedType: "array-of-non-empty-strings" });
  const trigger = requiredObject(record, "deployment_trigger", `${jsonPath}.deployment_trigger`);
  const metadata = requiredObject(trigger, "metadata", `${jsonPath}.deployment_trigger.metadata`);
  const stage = requiredObject(record, "latest_stage", `${jsonPath}.latest_stage`);
  const isSkipped = required(record, "is_skipped", `${jsonPath}.is_skipped`, "boolean");
  if (typeof isSkipped !== "boolean") fail("PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", { jsonPath: `${jsonPath}.is_skipped`, observedType: observedType(isSkipped), expectedType: "boolean" });
  return {
    id,
    aliases: [...new Set(aliases)],
    environment: requiredString(record, "environment", `${jsonPath}.environment`),
    immutableDeploymentUrl: normalizedImmutableUrl(requiredString(record, "url", `${jsonPath}.url`), `${jsonPath}.url`),
    branch: requiredString(metadata, "branch", `${jsonPath}.deployment_trigger.metadata.branch`),
    commitHash: requiredString(metadata, "commit_hash", `${jsonPath}.deployment_trigger.metadata.commit_hash`),
    stageName: requiredString(stage, "name", `${jsonPath}.latest_stage.name`),
    stageStatus: requiredString(stage, "status", `${jsonPath}.latest_stage.status`),
    isSkipped,
  };
}

/** Parses the official Pages Project GET envelope. Runtime policy deliberately rejects nullable target fields. */
export function parsePagesProjectGet(rawBytes) {
  const envelope = decode(rawBytes);
  if (!object(envelope)) fail("PAGES_PROJECT_GET_RESULT_INVALID");
  if (envelope.success !== true || (own(envelope, "errors") && (!Array.isArray(envelope.errors) || envelope.errors.length !== 0))) fail("PAGES_PROJECT_GET_API_ERROR");
  if (own(envelope, "messages") && !Array.isArray(envelope.messages)) fail("PAGES_PROJECT_GET_RESULT_INVALID");
  const result = requiredObject(envelope, "result", "result");
  const canonical = normalizeDeployment(requiredObject(result, "canonical_deployment", "result.canonical_deployment"), "result.canonical_deployment");
  const latest = normalizeDeployment(requiredObject(result, "latest_deployment", "result.latest_deployment"), "result.latest_deployment");
  return {
    parserVersion: PAGES_PROJECT_GET_PARSER_VERSION,
    rawResponseSha256: sha256(rawBytes),
    project: {
      id: requiredString(result, "id", "result.id"),
      name: requiredString(result, "name", "result.name"),
      productionBranch: requiredString(result, "production_branch", "result.production_branch"),
      canonicalDeployment: canonical,
      latestDeployment: latest,
      subdomain: own(result, "subdomain") && result.subdomain !== null ? requiredString(result, "subdomain", "result.subdomain") : null,
    },
  };
}

function mismatch(jsonPath, expectedType = "expected-exact-target") {
  fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath, observedType: "value-withheld", expectedType });
}

/** Selects one canonical Production target; a latest Production deployment may not conflict with it. */
export function selectExactCanonicalProjectTarget(parsed, expected = {}) {
  if (!object(parsed) || !object(parsed.project)) fail("PAGES_PROJECT_GET_RESULT_INVALID");
  const deploymentId = String(expected.deploymentId ?? "").toLowerCase();
  const sourceCommit = String(expected.sourceCommit ?? "");
  if (!UUID.test(deploymentId)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_MISSING", { jsonPath: "expected.deploymentId", observedType: "missing-or-invalid", expectedType: "uuid" });
  if (!COMMIT.test(sourceCommit)) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_MISSING", { jsonPath: "expected.sourceCommit", observedType: "missing-or-invalid", expectedType: "full-lowercase-commit" });
  const { project } = parsed;
  const canonical = project.canonicalDeployment;
  const latest = project.latestDeployment;
  if (project.name !== PAGES_PROJECT) mismatch("result.name", "openglasshub");
  if (project.productionBranch !== "main") mismatch("result.production_branch", "main");
  if (canonical.id !== deploymentId) mismatch("result.canonical_deployment.id", "expected-canonical-deployment-id");
  if (canonical.environment !== "production") mismatch("result.canonical_deployment.environment", "production");
  if (canonical.immutableDeploymentUrl !== `https://${deploymentId}.openglasshub.pages.dev/`) mismatch("result.canonical_deployment.url", "expected-immutable-deployment-url");
  if (!canonical.aliases.includes(CANONICAL_PRODUCTION_URL)) mismatch("result.canonical_deployment.aliases", "contains-canonical-production-url");
  if (canonical.branch !== "main") mismatch("result.canonical_deployment.deployment_trigger.metadata.branch", "main");
  if (!COMMIT.test(canonical.commitHash) || canonical.commitHash !== sourceCommit) mismatch("result.canonical_deployment.deployment_trigger.metadata.commit_hash", "expected-full-source-commit");
  if (canonical.isSkipped) mismatch("result.canonical_deployment.is_skipped", "false");
  if (canonical.stageName !== "deploy" || canonical.stageStatus !== "success") mismatch("result.canonical_deployment.latest_stage", "deploy-success");
  if (latest.environment === "production" && latest.id !== canonical.id) fail("PAGES_PROJECT_GET_REQUIRED_FIELD_CONFLICT", { jsonPath: "result.latest_deployment.id", observedType: "value-withheld", expectedType: "matches-canonical-production-deployment-id" });
  return Object.freeze({
    classification: "PAGES_PROJECT_GET_TARGET_VERIFIED",
    parserVersion: PAGES_PROJECT_GET_PARSER_VERSION,
    transportVersion: PAGES_PROJECT_GET_TRANSPORT_VERSION,
    sourceContractSha256: PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256,
    rawResponseSha256: parsed.rawResponseSha256,
    projectName: project.name,
    projectId: project.id,
    productionBranch: project.productionBranch,
    deploymentId: canonical.id,
    environment: canonical.environment,
    immutableDeploymentUrl: canonical.immutableDeploymentUrl,
    canonicalAlias: CANONICAL_PRODUCTION_URL,
    branch: canonical.branch,
    sourceCommit: canonical.commitHash,
    stage: { name: canonical.stageName, status: canonical.stageStatus },
  });
}

export function pagesProjectGetStructuralDiagnostic(rawBytes) {
  try {
    parsePagesProjectGet(rawBytes);
    return { parserVersion: PAGES_PROJECT_GET_PARSER_VERSION, rawResponseSha256: sha256(rawBytes), classification: "PAGES_PROJECT_GET_PARSE_OK" };
  } catch (error) {
    return {
      parserVersion: PAGES_PROJECT_GET_PARSER_VERSION,
      rawResponseSha256: sha256(rawBytes),
      classification: error?.code ?? "PAGES_PROJECT_GET_RESULT_INVALID",
      ...(error?.jsonPath ? { jsonPath: error.jsonPath, observedType: error.observedType, expectedType: error.expectedType, diagnosticReference: error.diagnosticReference } : {}),
    };
  }
}

/** The only representable Project metadata request: exact host, path, GET, no query, no redirect, no retry. */
export function fixedProjectGetRequest({ accountId }) {
  if (!ACCOUNT_ID.test(String(accountId ?? ""))) fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath: "accountId", observedType: "value-withheld", expectedType: "32-lowercase-hex" });
  const url = new URL(`${CLOUDFLARE_API_PREFIX}/accounts/${accountId}/pages/projects/${PAGES_PROJECT}`, CLOUDFLARE_API_ORIGIN);
  return Object.freeze({ method: "GET", url: url.toString(), redirect: "error", timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES, retryCount: 0 });
}

export function clearCloudflareAuthEnvironment(environment = process.env) {
  for (const name of AUTH_ENVIRONMENT_NAMES) delete environment[name];
}

/** Future-only transport. Tests inject a fake fetch; this module never initiates a request on import. */
export async function executeFixedProjectGet({ accountId, auth, fetchImpl = globalThis.fetch, environment = process.env } = {}) {
  if (!auth || !nonEmptyString(auth.token) || typeof fetchImpl !== "function") fail("PAGES_PROJECT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  if (AUTH_ENVIRONMENT_NAMES.some((name) => environment[name])) fail("PAGES_PROJECT_GET_AUTH_TRANSPORT_UNAVAILABLE");
  const request = fixedProjectGetRequest({ accountId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    let response;
    try { response = await fetchImpl(request.url, { method: request.method, redirect: request.redirect, signal: controller.signal, headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" } }); }
    catch { fail("PAGES_PROJECT_GET_AUTH_TRANSPORT_UNAVAILABLE"); }
    if (response.redirected || new URL(response.url || request.url).origin !== CLOUDFLARE_API_ORIGIN) fail("PAGES_PROJECT_GET_TARGET_MISMATCH", { jsonPath: "transport.url", observedType: "value-withheld", expectedType: "fixed-cloudflare-api-origin" });
    if (response.status === 401 || response.status === 403) fail("PAGES_PROJECT_GET_AUTH_TRANSPORT_UNAVAILABLE");
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length === 0 || raw.length > request.maxResponseBytes) fail("PAGES_PROJECT_GET_RESULT_INVALID");
    return { request: { method: request.method, endpointSha256: sha256(request.url), accountIdSha256: sha256(accountId), retryCount: 0 }, raw };
  } finally {
    clearTimeout(timer);
    clearCloudflareAuthEnvironment(environment);
    auth.token = null;
  }
}
