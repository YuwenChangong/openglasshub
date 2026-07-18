import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CANONICAL_PRODUCTION_URL, PagesDeploymentGetError, clearCloudflareAuthEnvironment, executeFixedDeploymentGet,
  fixedDeploymentGetRequest, pagesDeploymentGetStructuralDiagnostic, parsePagesDeploymentGet,
  processEphemeralDeploymentResponse, readExistingWranglerAuth, sanitizeDeploymentSelection, selectExactProductionDeployment,
} from "./qa/cloudflare-pages-deployment-get.mjs";

const deploymentId = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
const commit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const deployment = (patch = {}) => ({
  id: deploymentId, project_name: "openglasshub", environment: "production", url: "https://6f11bcf1.openglasshub.pages.dev/",
  aliases: [CANONICAL_PRODUCTION_URL], deployment_trigger: { type: "ad_hoc", metadata: { branch: "main", commit_hash: commit } },
  latest_stage: { name: "deploy", status: "success" }, is_skipped: false, ...patch,
});
const envelope = (patch = {}) => ({ success: true, errors: [], messages: [], result: deployment(), ...patch });
const bytes = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
const fail = (value, code, jsonPath = null) => assert.throws(() => parsePagesDeploymentGet(bytes(value)), (error) => error instanceof PagesDeploymentGetError && error.code === code && (jsonPath === null || (error.jsonPath === jsonPath && error.diagnosticReference === `${code}:${jsonPath}`)));
const exact = () => selectExactProductionDeployment(parsePagesDeploymentGet(bytes(envelope())), { deploymentId, sourceCommit: commit });

assert.equal(exact().classification, "PAGES_DEPLOYMENT_GET_TARGET_VERIFIED");
assert.equal(sanitizeDeploymentSelection(exact()).canonicalAlias, CANONICAL_PRODUCTION_URL);
assert.equal(exact().commitDirty, undefined);
assert.equal(Object.hasOwn(sanitizeDeploymentSelection(exact()), "commitDirty"), false);
assert.equal(selectExactProductionDeployment(parsePagesDeploymentGet(bytes(envelope({ result: deployment({ commit_dirty: true, unsupported_optional: { value: "ignored" } }) }))), { deploymentId, sourceCommit: commit }).classification, "PAGES_DEPLOYMENT_GET_TARGET_VERIFIED");
fail(null, "PAGES_DEPLOYMENT_GET_RESULT_INVALID");
fail(envelope({ success: false }), "PAGES_DEPLOYMENT_GET_API_ERROR");
fail(envelope({ errors: [{ code: 1 }] }), "PAGES_DEPLOYMENT_GET_API_ERROR");
fail(envelope({ result: null }), "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
fail(envelope({ result: [] }), "PAGES_DEPLOYMENT_GET_RESULT_INVALID");
for (const [patch, code] of [
  [{ id: undefined }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING"], [{ id: null }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL"], [{ id: 3 }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID"],
  [{ aliases: null }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL"], [{ aliases: "x" }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID"],
]) fail(envelope({ result: deployment(patch) }), code);
const setAt = (value, jsonPath, replacement, remove = false) => {
  const copy = structuredClone(value); const keys = jsonPath.split("."); let target = copy;
  for (const key of keys.slice(0, -1)) target = target[key];
  if (remove) delete target[keys.at(-1)]; else target[keys.at(-1)] = replacement;
  return copy;
};
const requiredPaths = [
  "result.id", "result.project_name", "result.environment", "result.url", "result.aliases", "result.deployment_trigger",
  "result.deployment_trigger.metadata", "result.deployment_trigger.metadata.branch", "result.deployment_trigger.metadata.commit_hash",
  "result.latest_stage", "result.latest_stage.name", "result.latest_stage.status", "result.is_skipped",
];
for (const jsonPath of requiredPaths) {
  fail(setAt(envelope(), jsonPath, undefined, true), "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING", jsonPath);
  fail(setAt(envelope(), jsonPath, null), "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL", jsonPath);
}
for (const [jsonPath, replacement] of [["result.id", 1], ["result.aliases", "not-array"], ["result.latest_stage", []], ["result.is_skipped", "false"]]) {
  fail(setAt(envelope(), jsonPath, replacement), "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_TYPE_INVALID", jsonPath);
}
const mismatch = (patch, code) => assert.throws(() => selectExactProductionDeployment(parsePagesDeploymentGet(bytes(envelope({ result: deployment(patch) }))), { deploymentId, sourceCommit: commit }), new RegExp(code));
mismatch({ id: "11111111-1111-4111-8111-111111111111" }, "PAGES_DEPLOYMENT_GET_DEPLOYMENT_ID_MISMATCH");
mismatch({ project_name: "other" }, "PAGES_DEPLOYMENT_GET_PROJECT_MISMATCH");
mismatch({ environment: "preview" }, "PAGES_DEPLOYMENT_GET_ENVIRONMENT_MISMATCH");
mismatch({ url: "https://example.com/" }, "PAGES_DEPLOYMENT_GET_TARGET_MISMATCH");
mismatch({ aliases: [] }, "PAGES_DEPLOYMENT_GET_ALIAS_MISMATCH");
mismatch({ deployment_trigger: { type: "x", metadata: { branch: "other", commit_hash: commit } } }, "PAGES_DEPLOYMENT_GET_BRANCH_MISMATCH");
mismatch({ deployment_trigger: { type: "x", metadata: { branch: "main", commit_hash: "b9ec4a0" } } }, "PAGES_DEPLOYMENT_GET_COMMIT_INVALID");
mismatch({ deployment_trigger: { type: "x", metadata: { branch: "main", commit_hash: "a".repeat(40) } } }, "PAGES_DEPLOYMENT_GET_COMMIT_MISMATCH");
mismatch({ latest_stage: { name: "deploy", status: "failure" } }, "PAGES_DEPLOYMENT_GET_STATUS_UNACCEPTABLE");
mismatch({ latest_stage: { name: "build", status: "success" } }, "PAGES_DEPLOYMENT_GET_STATUS_UNACCEPTABLE");
mismatch({ is_skipped: true }, "PAGES_DEPLOYMENT_GET_STATUS_UNACCEPTABLE");
mismatch({ latest_stage: { name: "deploy", status: null } }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
mismatch({ latest_stage: { name: "deploy" } }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_MISSING");
mismatch({ is_skipped: null }, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
const diagnostic = pagesDeploymentGetStructuralDiagnostic(bytes({ result: { id: "private-value", token: "not-for-output" } }));
assert.equal(JSON.stringify(diagnostic).includes("private-value"), false);
assert.equal(JSON.stringify(diagnostic).includes("not-for-output"), false);
const nullDiagnostic = pagesDeploymentGetStructuralDiagnostic(bytes(envelope({ result: deployment({ latest_stage: null }) })));
assert.equal(nullDiagnostic.classification, "PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL");
assert.equal(nullDiagnostic.jsonPath, "result.latest_stage");
assert.equal(nullDiagnostic.observedType, "null");
assert.equal(nullDiagnostic.expectedType, "object");
assert.equal(JSON.stringify(nullDiagnostic).includes("private-value"), false);
assert.throws(() => fixedDeploymentGetRequest({ accountId: "not-account", deploymentId }), /PAGES_DEPLOYMENT_GET_TARGET_MISMATCH/);
assert.throws(() => fixedDeploymentGetRequest({ accountId: "a".repeat(32), deploymentId: "not-uuid" }), /PAGES_DEPLOYMENT_GET_DEPLOYMENT_ID_MISMATCH/);
const request = fixedDeploymentGetRequest({ accountId: "a".repeat(32), deploymentId });
assert.equal(request.method, "GET"); assert.equal(new URL(request.url).origin, "https://api.cloudflare.com"); assert.equal(new URL(request.url).search, "");
let calls = 0; const env = { CLOUDFLARE_API_TOKEN: undefined };
const fakeFetch = async (url, options) => { calls += 1; assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(url, request.url); return new Response(bytes(envelope()), { status: 200 }); };
const executed = await executeFixedDeploymentGet({ deploymentId, fetchImpl: fakeFetch, auth: { accountId: "a".repeat(32), token: "test_token.value" }, environment: env });
assert.equal(calls, 1); assert.equal(executed.raw.length > 0, true);
assert.equal(Object.hasOwn(env, "CLOUDFLARE_API_TOKEN"), false, "credential environment is removed after success");
await assert.rejects(executeFixedDeploymentGet({ deploymentId, fetchImpl: async () => new Response("", { status: 401 }), auth: { accountId: "a".repeat(32), token: "test_token.value" }, environment: {} }), /PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE/);
await assert.rejects(executeFixedDeploymentGet({ deploymentId, fetchImpl: async () => new Response("", { status: 403 }), auth: { accountId: "a".repeat(32), token: "test_token.value" }, environment: {} }), /PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE/);
await assert.rejects(executeFixedDeploymentGet({ deploymentId, fetchImpl: async () => ({ redirected: true, url: "https://example.invalid/", status: 200, arrayBuffer: async () => bytes(envelope()).buffer }), auth: { accountId: "a".repeat(32), token: "test_token.value" }, environment: {} }), /PAGES_DEPLOYMENT_GET_TARGET_MISMATCH/);
await assert.rejects(executeFixedDeploymentGet({ deploymentId, fetchImpl: async () => { throw new Error("timeout"); }, auth: { accountId: "a".repeat(32), token: "test_token.value" }, environment: {} }), /PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE/);
assert.equal(calls, 1, "failed fetches do not retry");
const temp = await mkdtemp(path.join(os.tmpdir(), "pages-deployment-get-"));
try {
  for (const [name, body, code] of [["good", bytes(envelope()), "PAGES_DEPLOYMENT_GET_PARSE_OK"], ["bad", bytes({ success: false }), "PAGES_DEPLOYMENT_GET_API_ERROR"]]) {
    const file = path.join(temp, `${name}.json`); await writeFile(file, body);
    const result = await processEphemeralDeploymentResponse(file); assert.equal(result.classification, code); await assert.rejects(readFile(file), /ENOENT/);
  }
  const profileRoot = path.join(temp, "appdata", "xdg.config", ".wrangler");
  const profileRepo = path.join(temp, "profile-repo");
  await mkdir(profileRepo, { recursive: true });
  await mkdir(path.join(profileRoot, "config"), { recursive: true });
  await writeFile(path.join(profileRoot, "config", "default.toml"), 'oauth_token = "test_token.value"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n');
  await writeFile(path.join(profileRepo, "wrangler.toml"), `account_id = "${"a".repeat(32)}"\n`);
  const profile = await readExistingWranglerAuth({ repositoryRoot: profileRepo, home: path.join(temp, "no-legacy"), appData: path.join(temp, "appdata") });
  assert.equal(profile.accountId, "a".repeat(32));
  assert.equal(profile.token, "test_token.value");
  await rm(path.join(profileRepo, "wrangler.toml"));
  const hiddenProfile = await readExistingWranglerAuth({ repositoryRoot: profileRepo, home: path.join(temp, "no-legacy"), appData: path.join(temp, "appdata"), requestHiddenInput: async () => "a".repeat(32) });
  assert.equal(hiddenProfile.accountResolution, "PAGES_ACCOUNT_ID_RESOLVED_HIDDEN_INPUT");
  await writeFile(path.join(profileRoot, "config", "default.toml"), 'oauth_token = "test_token.value"\nexpiration_time = "2000-01-01T00:00:00.000Z"\n');
  await assert.rejects(readExistingWranglerAuth({ repositoryRoot: profileRepo, home: path.join(temp, "no-legacy"), appData: path.join(temp, "appdata"), requestHiddenInput: async () => "a".repeat(32) }), /PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE/);
} finally { await rm(temp, { recursive: true, force: true }); }
const cleanup = { CLOUDFLARE_API_TOKEN: "value", CLOUDFLARE_EMAIL: "value" }; clearCloudflareAuthEnvironment(cleanup); assert.equal(Object.keys(cleanup).length, 0);
console.log("PAGES_DEPLOYMENT_GET_MINIMUM_CONTRACT_OK parser, selector, fixed GET transport, no retry, diagnostics, and raw lifecycle passed with fake local responses only");
