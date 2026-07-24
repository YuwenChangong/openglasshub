import assert from "node:assert/strict";
import { PAGES_PROJECT_R2_COMMIT, PagesProjectR2Error, parsePagesProjectR2Get, selectObservedCurrentProjectV3Target } from "./qa/cloudflare-pages-project-v3-get.mjs";

const OMIT = Symbol("omit");
const observedId = "11111111-1111-4111-8111-111111111111";
const observedUrl = "https://current-observed.openglasshub.pages.dev/";
const projectId = "project-r2-id";
function deployment({ id = observedId, url = observedUrl, ...patch } = {}) {
  const value = { project_id: projectId, project_name: "openglasshub", environment: "production", aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: PAGES_PROJECT_R2_COMMIT } }, latest_stage: { name: "deploy", status: "success" }, is_skipped: false, ...patch };
  if (id !== OMIT) value.id = id;
  if (url !== OMIT) value.url = url;
  return value;
}
function envelope(canonical = deployment(), patch = {}) { return { success: true, errors: [], result: { id: projectId, name: "openglasshub", subdomain: "openglasshub.pages.dev", production_branch: "main", canonical_deployment: canonical, latest_deployment: { id: canonical.id, environment: "production" }, ...patch } }; }
const exact = value => selectObservedCurrentProjectV3Target(parsePagesProjectR2Get(Buffer.from(JSON.stringify(value))));
assert.equal(Object.hasOwn(deployment({ id: OMIT }), "id"), false, "fixture omission is real");
assert.equal(Object.hasOwn(deployment({ url: OMIT }), "url"), false, "fixture omission is real");
const valid = exact(envelope());
assert.equal(valid.deploymentId, observedId); assert.equal(valid.immutableDeploymentUrl, observedUrl);
assert.equal(exact(envelope(deployment({ id: "22222222-2222-4222-8222-222222222222", url: "https://different-current.openglasshub.pages.dev/" }))).deploymentId, "22222222-2222-4222-8222-222222222222");
const cases = [
  [deployment({ id: OMIT }), "PAGES_PROJECT_R2_REQUIRED_FIELD_MISSING", "result.canonical_deployment.id"], [deployment({ id: null }), "PAGES_PROJECT_R2_REQUIRED_FIELD_NULL", "result.canonical_deployment.id"], [deployment({ id: "" }), "PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.canonical_deployment.id"], [deployment({ id: 1 }), "PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.canonical_deployment.id"], [deployment({ id: "invalid" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.id"],
  [deployment({ url: OMIT }), "PAGES_PROJECT_R2_REQUIRED_FIELD_MISSING", "result.canonical_deployment.url"], [deployment({ url: null }), "PAGES_PROJECT_R2_REQUIRED_FIELD_NULL", "result.canonical_deployment.url"], [deployment({ url: "" }), "PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.canonical_deployment.url"], [deployment({ url: 1 }), "PAGES_PROJECT_R2_REQUIRED_FIELD_TYPE_INVALID", "result.canonical_deployment.url"], [deployment({ url: "not a url" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "http://current-observed.openglasshub.pages.dev/" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://user@current-observed.openglasshub.pages.dev/" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://current-observed.openglasshub.pages.dev:8443/" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://current-observed.openglasshub.pages.dev/path" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://current-observed.openglasshub.pages.dev/?x=1" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://current-observed.openglasshub.pages.dev/#x" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://other.pages.dev/" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"], [deployment({ url: "https://openglasshub.pages.dev/" }), "PAGES_PROJECT_V3_TARGET_MISMATCH", "result.canonical_deployment.url"],
];
for (const [canonical, code, jsonPath] of cases) assert.throws(() => exact(envelope(canonical)), error => error instanceof PagesProjectR2Error && error.code === code && error.jsonPath === jsonPath);
assert.throws(() => exact(envelope(deployment({ deployment_trigger: { metadata: { branch: "main", commit_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }))), error => error.code === "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH");
console.log("PAGES_PROJECT_V3_GET_OK explicit omission fixture, observed-current identity, and value-blind negative parsing passed with zero network");
