import assert from "node:assert/strict";
import {
  CANONICAL_PRODUCTION_URL,
  PagesProjectGetError,
  clearCloudflareAuthEnvironment,
  executeFixedProjectGet,
  fixedProjectGetRequest,
  pagesProjectGetStructuralDiagnostic,
  parsePagesProjectGet,
  selectExactCanonicalProjectTarget,
} from "./qa/cloudflare-pages-project-get.mjs";

const deploymentId = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
const commit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const deployment = (patch = {}) => ({
  id: deploymentId,
  aliases: [CANONICAL_PRODUCTION_URL],
  environment: "production",
  url: `https://${deploymentId}.openglasshub.pages.dev/`,
  deployment_trigger: { metadata: { branch: "main", commit_hash: commit } },
  latest_stage: { name: "deploy", status: "success" },
  is_skipped: false,
  ...patch,
});
const project = (patch = {}) => ({
  id: "project-id",
  name: "openglasshub",
  production_branch: "main",
  canonical_deployment: deployment(),
  latest_deployment: deployment(),
  subdomain: "openglasshub",
  ...patch,
});
const envelope = (patch = {}) => ({ success: true, errors: [], messages: [], result: project(), ...patch });
const bytes = (value) => Buffer.from(JSON.stringify(value), "utf8");
const exact = (value = envelope()) => selectExactCanonicalProjectTarget(parsePagesProjectGet(bytes(value)), { deploymentId, sourceCommit: commit });
const expectFailure = (value, code, jsonPath) => assert.throws(
  () => parsePagesProjectGet(bytes(value)),
  (error) => error instanceof PagesProjectGetError && error.code === code && (!jsonPath || error.jsonPath === jsonPath),
);
const setAt = (value, jsonPath, replacement, remove = false) => {
  const copy = structuredClone(value);
  const keys = jsonPath.split(".");
  let target = copy;
  for (const key of keys.slice(0, -1)) target = target[key];
  if (remove) delete target[keys.at(-1)]; else target[keys.at(-1)] = replacement;
  return copy;
};

assert.equal(exact().classification, "PAGES_PROJECT_GET_TARGET_VERIFIED");
assert.equal(exact().canonicalAlias, CANONICAL_PRODUCTION_URL);
assert.equal(exact().sourceCommit, commit);

for (const jsonPath of [
  "result", "result.id", "result.name", "result.production_branch", "result.canonical_deployment", "result.latest_deployment",
  "result.canonical_deployment.id", "result.canonical_deployment.aliases", "result.canonical_deployment.environment", "result.canonical_deployment.url",
  "result.canonical_deployment.deployment_trigger", "result.canonical_deployment.deployment_trigger.metadata",
  "result.canonical_deployment.deployment_trigger.metadata.branch", "result.canonical_deployment.deployment_trigger.metadata.commit_hash",
  "result.canonical_deployment.latest_stage", "result.canonical_deployment.latest_stage.name", "result.canonical_deployment.latest_stage.status", "result.canonical_deployment.is_skipped",
]) {
  expectFailure(setAt(envelope(), jsonPath, undefined, true), "PAGES_PROJECT_GET_REQUIRED_FIELD_MISSING", jsonPath);
  expectFailure(setAt(envelope(), jsonPath, null), "PAGES_PROJECT_GET_REQUIRED_FIELD_NULL", jsonPath);
}
for (const [jsonPath, replacement] of [
  ["result", []], ["result.name", 1], ["result.canonical_deployment", []], ["result.canonical_deployment.aliases", "not-array"],
  ["result.canonical_deployment.latest_stage", []], ["result.canonical_deployment.is_skipped", "false"],
]) expectFailure(setAt(envelope(), jsonPath, replacement), "PAGES_PROJECT_GET_REQUIRED_FIELD_TYPE_INVALID", jsonPath);

const mismatch = (patch, path) => assert.throws(
  () => exact(envelope({ result: project({ canonical_deployment: deployment(patch) }) })),
  (error) => error instanceof PagesProjectGetError && error.code === "PAGES_PROJECT_GET_TARGET_MISMATCH" && error.jsonPath === path,
);
mismatch({ id: "11111111-1111-4111-8111-111111111111" }, "result.canonical_deployment.id");
mismatch({ environment: "preview" }, "result.canonical_deployment.environment");
mismatch({ url: "https://example.invalid/" }, "result.canonical_deployment.url");
mismatch({ aliases: [] }, "result.canonical_deployment.aliases");
mismatch({ deployment_trigger: { metadata: { branch: "other", commit_hash: commit } } }, "result.canonical_deployment.deployment_trigger.metadata.branch");
mismatch({ deployment_trigger: { metadata: { branch: "main", commit_hash: "b9ec4a0" } } }, "result.canonical_deployment.deployment_trigger.metadata.commit_hash");
mismatch({ is_skipped: true }, "result.canonical_deployment.is_skipped");
mismatch({ latest_stage: { name: "build", status: "success" } }, "result.canonical_deployment.latest_stage");
assert.throws(() => exact(envelope({ result: project({ production_branch: "other" }) })), /PAGES_PROJECT_GET_TARGET_MISMATCH/);
assert.throws(() => exact(envelope({ result: project({ name: "other" }) })), /PAGES_PROJECT_GET_TARGET_MISMATCH/);

const conflictingLatest = project({ latest_deployment: deployment({ id: "11111111-1111-4111-8111-111111111111" }) });
assert.throws(() => exact(envelope({ result: conflictingLatest })), (error) => error instanceof PagesProjectGetError && error.code === "PAGES_PROJECT_GET_REQUIRED_FIELD_CONFLICT" && error.jsonPath === "result.latest_deployment.id");
const previewLatest = project({ latest_deployment: deployment({ id: "11111111-1111-4111-8111-111111111111", environment: "preview" }) });
assert.equal(exact(envelope({ result: previewLatest })).classification, "PAGES_PROJECT_GET_TARGET_VERIFIED");

const diagnostic = pagesProjectGetStructuralDiagnostic(bytes({ success: true, result: { name: "private-value", token: "not-for-output" } }));
assert.equal(JSON.stringify(diagnostic).includes("private-value"), false);
assert.equal(JSON.stringify(diagnostic).includes("not-for-output"), false);
assert.equal(diagnostic.classification, "PAGES_PROJECT_GET_REQUIRED_FIELD_MISSING");
assert.equal(diagnostic.jsonPath, "result.canonical_deployment");

assert.throws(() => fixedProjectGetRequest({ accountId: "bad" }), /PAGES_PROJECT_GET_TARGET_MISMATCH/);
const request = fixedProjectGetRequest({ accountId: "a".repeat(32) });
assert.equal(request.method, "GET");
assert.equal(request.url, "https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pages/projects/openglasshub");
assert.equal(new URL(request.url).search, "");
assert.equal(request.redirect, "error");
assert.equal(request.retryCount, 0);
let calls = 0;
const environment = {};
const executed = await executeFixedProjectGet({
  accountId: "a".repeat(32),
  auth: { token: "test-token" },
  environment,
  fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, request.url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    return new Response(bytes(envelope()), { status: 200 });
  },
});
assert.equal(calls, 1);
assert.equal(executed.request.retryCount, 0);
assert.equal(executed.raw.length > 0, true);
await assert.rejects(executeFixedProjectGet({ accountId: "a".repeat(32), auth: { token: "test-token" }, environment: {}, fetchImpl: async () => { throw new Error("network"); } }), /PAGES_PROJECT_GET_AUTH_TRANSPORT_UNAVAILABLE/);
assert.equal(calls, 1, "the project transport never retries a failed request");
const cleanup = { CLOUDFLARE_API_TOKEN: "value", CLOUDFLARE_EMAIL: "value" };
clearCloudflareAuthEnvironment(cleanup);
assert.equal(Object.keys(cleanup).length, 0);

console.log("PAGES_PROJECT_GET_MINIMUM_CONTRACT_OK fake Project GET parser, canonical selector, fixed transport, conflict policy, and value-blind diagnostics passed with zero provider requests");
