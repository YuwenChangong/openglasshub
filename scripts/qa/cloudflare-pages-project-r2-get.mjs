import { createHash } from "node:crypto";

export const PAGES_PROJECT_R2_GET_PARSER_VERSION = "cloudflare-pages-project-r2-get-v1";
export const PAGES_PROJECT_R2_GET_TRANSPORT_VERSION = "cloudflare-pages-project-r2-get-v1";
export const PAGES_PROJECT_R2_SOURCE_CONTRACT_HASHES = Object.freeze([
  "7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0",
  "10d35dd1fa3d42e48a0abf9b585d93673941f5336fa18f66bec09d2d222c0793",
  "2ab54ab5f18040ec80caeaa2dea7cd202f3f696ac4b589fc4874282a74590d63",
  "d663755d742e7f75c22a6aa77ddda4fb9401ae23815b7d50a23d0f80be4b771d",
  "89beea55ff2cee9ffeac79703ee56558761dbbbe34dc68d52a2a7e563519b27e",
]);
export const PAGES_PROJECT_R2_PROOF_R1 = "CANONICAL_DEPLOYMENT_ALIASES_V1";
export const PAGES_PROJECT_R2_PROOF_R2 = "PROJECT_SUBDOMAIN_PRODUCTION_BINDING_V1";
export const PAGES_PROJECT_R2 = "openglasshub";
export const PAGES_PROJECT_R2_SUBDOMAIN = "openglasshub.pages.dev";
export const PAGES_PROJECT_R2_CANONICAL_URL = "https://openglasshub.pages.dev";
export const PAGES_PROJECT_R2_DEPLOYMENT_ID = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
export const PAGES_PROJECT_R2_COMMIT = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
export const PAGES_PROJECT_R2_MAX_RESPONSE_BYTES = 1024 * 1024;
export const PAGES_PROJECT_R2_TIMEOUT_MS = 15_000;
const API_ORIGIN = "https://api.cloudflare.com";
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");

export class PagesProjectR2Error extends Error {
  constructor(code, jsonPath = null) { super(code); this.code = code; this.jsonPath = jsonPath; this.diagnosticReference = jsonPath ? `${code}:${jsonPath}` : code; }
}
const fail = (code, jsonPath = null) => { throw new PagesProjectR2Error(code, jsonPath); };
function required(record, key, path) { if (!own(record, key)) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_MISSING", path); if (record[key] === null) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_NULL", path); return record[key]; }
function requiredObject(record, key, path) { const value = required(record, key, path); if (!object(value)) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", path); return value; }
function requiredString(record, key, path) { const value = required(record, key, path); if (typeof value !== "string" || value.length === 0) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", path); return value; }
function requireUuid(value, path) { const text = String(value).toLowerCase(); if (!UUID.test(text)) fail("PAGES_PROJECT_R2_TARGET_MISMATCH", path); return text; }
function requireBool(value, path) { if (typeof value !== "boolean") fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", path); return value; }

export function normalizeProjectSubdomain(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value !== value.toLowerCase() || /[\u0000-\u001f\u007f-\u009f\s]/.test(value)) fail("PAGES_PROJECT_R2_SUBDOMAIN_INVALID", "result.subdomain");
  if (value.includes("://") || /[/?#@:*]/.test(value) || value.endsWith(".") || value.includes("..") || /[^a-z0-9.-]/.test(value)) fail("PAGES_PROJECT_R2_SUBDOMAIN_INVALID", "result.subdomain");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/.test(value)) fail("PAGES_PROJECT_R2_SUBDOMAIN_INVALID", "result.subdomain");
  const labels = value.split("."); if (labels.length !== 3 || labels[0] !== PAGES_PROJECT_R2) fail("PAGES_PROJECT_R2_SUBDOMAIN_INVALID", "result.subdomain");
  return value;
}

function normalizeImmutableUrl(value, path) {
  let url; try { url = new URL(value); } catch { fail("PAGES_PROJECT_R2_TARGET_MISMATCH", path); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || url.hostname !== `${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev`) fail("PAGES_PROJECT_R2_TARGET_MISMATCH", path);
  return url.toString();
}
function aliases(record, path) {
  if (!own(record, "aliases")) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_MISSING", path);
  if (record.aliases === null) return { observedType: "null", canonicalAlias: null };
  if (!Array.isArray(record.aliases) || !record.aliases.every((value) => typeof value === "string" && value.length > 0)) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", path);
  return { observedType: "array", canonicalAlias: record.aliases.includes(PAGES_PROJECT_R2_CANONICAL_URL) ? PAGES_PROJECT_R2_CANONICAL_URL : null };
}
function deployment(record, path) {
  const trigger = requiredObject(record, "deployment_trigger", `${path}.deployment_trigger`);
  const metadata = requiredObject(trigger, "metadata", `${path}.deployment_trigger.metadata`);
  const stage = requiredObject(record, "latest_stage", `${path}.latest_stage`);
  const alias = aliases(record, `${path}.aliases`);
  return {
    id: requireUuid(requiredString(record, "id", `${path}.id`), `${path}.id`),
    projectId: requiredString(record, "project_id", `${path}.project_id`),
    projectName: requiredString(record, "project_name", `${path}.project_name`),
    environment: requiredString(record, "environment", `${path}.environment`),
    immutableDeploymentUrl: normalizeImmutableUrl(requiredString(record, "url", `${path}.url`), `${path}.url`),
    aliasesObservedType: alias.observedType,
    canonicalAlias: alias.canonicalAlias,
    triggerBranch: requiredString(metadata, "branch", `${path}.deployment_trigger.metadata.branch`),
    sourceCommit: requiredString(metadata, "commit_hash", `${path}.deployment_trigger.metadata.commit_hash`),
    isSkipped: requireBool(required(record, "is_skipped", `${path}.is_skipped`), `${path}.is_skipped`),
    latestStageName: requiredString(stage, "name", `${path}.latest_stage.name`),
    latestStageStatus: requiredString(stage, "status", `${path}.latest_stage.status`),
  };
}
function latestConflict(record) {
  if (!own(record, "latest_deployment") || record.latest_deployment === null) return null;
  if (!object(record.latest_deployment)) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.latest_deployment");
  const latest = record.latest_deployment;
  return { id: requireUuid(requiredString(latest, "id", "result.latest_deployment.id"), "result.latest_deployment.id"), environment: requiredString(latest, "environment", "result.latest_deployment.environment") };
}

function optionalProjectSubdomain(record) {
  if (!own(record, "subdomain") || record.subdomain === null) return null;
  return normalizeProjectSubdomain(record.subdomain);
}

export function parsePagesProjectR2Get(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes ?? "");
  if (raw.length === 0 || raw.length > PAGES_PROJECT_R2_MAX_RESPONSE_BYTES) fail("PAGES_PROJECT_R2_RESULT_INVALID");
  let envelope; try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { fail("PAGES_PROJECT_R2_RESULT_INVALID"); }
  if (!object(envelope) || envelope.success !== true || (own(envelope, "errors") && (!Array.isArray(envelope.errors) || envelope.errors.length !== 0))) fail("PAGES_PROJECT_R2_API_ERROR");
  const result = requiredObject(envelope, "result", "result");
  const canonical = deployment(requiredObject(result, "canonical_deployment", "result.canonical_deployment"), "result.canonical_deployment");
  return Object.freeze({ rawResponseSha256: hash(raw), parserVersion: PAGES_PROJECT_R2_GET_PARSER_VERSION, project: Object.freeze({ id: requiredString(result, "id", "result.id"), name: requiredString(result, "name", "result.name"), subdomain: optionalProjectSubdomain(result), productionBranch: requiredString(result, "production_branch", "result.production_branch"), canonical, latest: latestConflict(result) }) });
}

export function selectExactProjectR2Target(parsed) {
  if (!parsed?.project) fail("PAGES_PROJECT_R2_RESULT_INVALID");
  const { project } = parsed; const canonical = project.canonical;
  if (project.name !== PAGES_PROJECT_R2 || project.productionBranch !== "main") fail("PAGES_PROJECT_R2_TARGET_MISMATCH", "result");
  if (canonical.id !== PAGES_PROJECT_R2_DEPLOYMENT_ID || canonical.projectId !== project.id || canonical.projectName !== project.name || canonical.environment !== "production" || canonical.immutableDeploymentUrl !== `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/` || canonical.triggerBranch !== "main" || !COMMIT.test(canonical.sourceCommit) || canonical.sourceCommit !== PAGES_PROJECT_R2_COMMIT || canonical.isSkipped || canonical.latestStageName !== "deploy" || canonical.latestStageStatus !== "success") fail("PAGES_PROJECT_R2_TARGET_MISMATCH", "result.canonical_deployment");
  if (project.latest?.environment === "production" && project.latest.id !== canonical.id) fail("PAGES_PROJECT_R2_REQUIRED_FIELD_CONFLICT", "result.latest_deployment.id");
  let canonicalTargetProofMode;
  if (canonical.aliasesObservedType === "array") { if (canonical.canonicalAlias !== PAGES_PROJECT_R2_CANONICAL_URL) fail("PAGES_PROJECT_R2_TARGET_MISMATCH", "result.canonical_deployment.aliases"); canonicalTargetProofMode = PAGES_PROJECT_R2_PROOF_R1; }
  else if (canonical.aliasesObservedType === "null") canonicalTargetProofMode = PAGES_PROJECT_R2_PROOF_R2;
  else fail("PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.canonical_deployment.aliases");
  if (canonicalTargetProofMode === PAGES_PROJECT_R2_PROOF_R2 && project.subdomain !== PAGES_PROJECT_R2_SUBDOMAIN) fail("PAGES_PROJECT_R2_TARGET_MISMATCH", "result.subdomain");
  return Object.freeze({ classification: "PAGES_PROJECT_R2_TARGET_VERIFIED", canonicalTargetProofMode, parserVersion: PAGES_PROJECT_R2_GET_PARSER_VERSION, transportVersion: PAGES_PROJECT_R2_GET_TRANSPORT_VERSION, sourceContractSha256s: PAGES_PROJECT_R2_SOURCE_CONTRACT_HASHES, rawResponseSha256: parsed.rawResponseSha256, projectName: project.name, projectId: project.id, projectSubdomain: project.subdomain, productionBranch: project.productionBranch, deploymentId: canonical.id, canonicalDeploymentProjectId: canonical.projectId, canonicalDeploymentProjectName: canonical.projectName, environment: canonical.environment, immutableDeploymentUrl: canonical.immutableDeploymentUrl, aliasesObservedType: canonical.aliasesObservedType, canonicalAlias: canonical.canonicalAlias, triggerBranch: canonical.triggerBranch, sourceCommit: canonical.sourceCommit, isSkipped: canonical.isSkipped, latestStageName: canonical.latestStageName, latestStageStatus: canonical.latestStageStatus });
}

export function fixedProjectR2GetRequest({ accountId }) {
  if (!ACCOUNT_ID.test(String(accountId ?? ""))) fail("PAGES_PROJECT_R2_TARGET_MISMATCH", "accountId");
  const url = new URL(`/client/v4/accounts/${accountId}/pages/projects/${PAGES_PROJECT_R2}`, API_ORIGIN);
  return Object.freeze({ method: "GET", url: url.toString(), redirect: "error", timeoutMs: PAGES_PROJECT_R2_TIMEOUT_MS, maxResponseBytes: PAGES_PROJECT_R2_MAX_RESPONSE_BYTES, retryCount: 0 });
}
export async function executeFixedProjectR2Get({ accountId, auth, fetchImpl = globalThis.fetch, environment = process.env } = {}) {
  if (!auth || typeof auth.token !== "string" || auth.token.length === 0 || typeof fetchImpl !== "function" || ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "CLOUDFLARE_API_USER_SERVICE_KEY"].some((name) => environment[name])) fail("PAGES_PROJECT_R2_AUTH_TRANSPORT_UNAVAILABLE");
  const request = fixedProjectR2GetRequest({ accountId }); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try { let response; try { response = await fetchImpl(request.url, { method: request.method, redirect: request.redirect, signal: controller.signal, headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" } }); } catch { fail("PAGES_PROJECT_R2_AUTH_TRANSPORT_UNAVAILABLE"); }
    if (response.redirected || new URL(response.url || request.url).origin !== API_ORIGIN || response.status === 401 || response.status === 403) fail("PAGES_PROJECT_R2_AUTH_TRANSPORT_UNAVAILABLE");
    const raw = Buffer.from(await response.arrayBuffer()); if (raw.length === 0 || raw.length > request.maxResponseBytes) fail("PAGES_PROJECT_R2_RESULT_INVALID"); return Object.freeze({ request: Object.freeze({ method: request.method, endpointSha256: hash(request.url), accountIdSha256: hash(accountId), timeoutMs: request.timeoutMs, maxResponseBytes: request.maxResponseBytes, retryCount: 0 }), raw });
  } finally { clearTimeout(timer); controller.abort(); }
}
export function validateProjectR2SourceContractHashes(values) { if (!Array.isArray(values) || values.length !== PAGES_PROJECT_R2_SOURCE_CONTRACT_HASHES.length || values.some((value, index) => !SHA256.test(String(value)) || value !== PAGES_PROJECT_R2_SOURCE_CONTRACT_HASHES[index])) fail("PAGES_PROJECT_R2_SOURCE_CONTRACT_INVALID"); return true; }
