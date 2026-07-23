import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PAGES_PROJECT_R2_COMMIT, PAGES_PROJECT_R2_DEPLOYMENT_ID, PAGES_PROJECT_R2_PROOF_R1, PAGES_PROJECT_R2_PROOF_R2,
  PAGES_PROJECT_R2_URL_NORMALIZATION_VERSION, PagesProjectR2Error, executeFixedProjectR2Get, fixedProjectR2GetRequest, parsePagesProjectR2Get, selectExactProjectR2Target,
} from "./qa/cloudflare-pages-project-r2-get.mjs";

const projectId = "project-r2-id";
const deployment = (patch = {}) => ({ id: PAGES_PROJECT_R2_DEPLOYMENT_ID, project_id: projectId, project_name: "openglasshub", environment: "production", url: `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/`, aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: PAGES_PROJECT_R2_COMMIT } }, latest_stage: { name: "deploy", status: "success" }, is_skipped: false, ...patch });
const envelope = (patch = {}) => ({ success: true, errors: [], result: { id: projectId, name: "openglasshub", subdomain: "openglasshub.pages.dev", production_branch: "main", canonical_deployment: deployment(), latest_deployment: deployment(), ...patch } });
const bytes = (value) => Buffer.from(JSON.stringify(value));
const exact = (value = envelope()) => selectExactProjectR2Target(parsePagesProjectR2Get(bytes(value)));
const expect = (value, path) => assert.throws(() => exact(value), (error) => error instanceof PagesProjectR2Error && error.jsonPath === path);

assert.equal(exact().canonicalTargetProofMode, PAGES_PROJECT_R2_PROOF_R1);
assert.equal(exact(envelope({ canonical_deployment: deployment({ url: `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev` }) })).immutableDeploymentUrl, `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/`);
assert.equal(exact(envelope({ canonical_deployment: deployment({ url: `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID.toUpperCase()}.OPENGLASSHUB.PAGES.DEV/` }) })).immutableDeploymentUrlNormalizationVersion, PAGES_PROJECT_R2_URL_NORMALIZATION_VERSION);
assert.equal(exact(envelope({ canonical_deployment: deployment({ url: `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev:443/` }) })).immutableDeploymentUrl, `https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/`);
assert.equal(exact(envelope({ subdomain: null })).canonicalTargetProofMode, PAGES_PROJECT_R2_PROOF_R1);
assert.equal(exact(envelope({ subdomain: undefined })).canonicalTargetProofMode, PAGES_PROJECT_R2_PROOF_R1);
assert.equal(exact(envelope({ canonical_deployment: deployment({ aliases: null }), latest_deployment: { id: PAGES_PROJECT_R2_DEPLOYMENT_ID, environment: "production" } })).canonicalTargetProofMode, PAGES_PROJECT_R2_PROOF_R2);
for (const [patch, path] of [
  [{ canonical_deployment: deployment({ aliases: undefined }) }, "result.canonical_deployment.aliases"],
  [{ canonical_deployment: deployment({ aliases: "x" }) }, "result.canonical_deployment.aliases"],
  [{ subdomain: "https://openglasshub.pages.dev" }, "result.subdomain"], [{ subdomain: "preview.openglasshub.pages.dev" }, "result.subdomain"], [{ subdomain: "OPenGlassHub.pages.dev" }, "result.subdomain"],
  [{ name: "other" }, "result"], [{ production_branch: "preview" }, "result"], [{ canonical_deployment: deployment({ project_id: "other" }) }, "result.canonical_deployment"], [{ canonical_deployment: deployment({ project_name: "other" }) }, "result.canonical_deployment"],
  [{ canonical_deployment: deployment({ environment: "preview" }) }, "result.canonical_deployment"], [{ canonical_deployment: deployment({ url: "https://other.openglasshub.pages.dev/" }) }, "result.canonical_deployment.url"], [{ canonical_deployment: deployment({ is_skipped: true }) }, "result.canonical_deployment"],
  [{ latest_deployment: { id: "11111111-1111-4111-8111-111111111111", environment: "production" } }, "result.latest_deployment.id"],
]) expect(envelope(patch), path);
expect(envelope({ subdomain: null, canonical_deployment: deployment({ aliases: null }), latest_deployment: { id: PAGES_PROJECT_R2_DEPLOYMENT_ID, environment: "production" } }), "result.subdomain");
assert.throws(() => parsePagesProjectR2Get(bytes(envelope({ canonical_deployment: null }))), /PAGES_PROJECT_R2_REQUIRED_FIELD_NULL/);
for (const [url, reason] of [
  [`http://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/`, "URL_SCHEME_MISMATCH"],
  [`https://user@${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/`, "URL_CREDENTIALS_PRESENT"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev:8443/`, "URL_PORT_MISMATCH"],
  [`https://other.openglasshub.pages.dev/`, "URL_HOSTNAME_MISMATCH"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.other.pages.dev/`, "URL_HOSTNAME_MISMATCH"],
  [`https://branch.openglasshub.pages.dev/`, "URL_HOSTNAME_MISMATCH"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/path`, "URL_ROOT_PATH_MISMATCH"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/?q=private`, "URL_QUERY_PRESENT"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev/#private`, "URL_FRAGMENT_PRESENT"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglasshub.pages.dev./`, "URL_HOSTNAME_MISMATCH"],
  [`https://${PAGES_PROJECT_R2_DEPLOYMENT_ID}.openglassh\u00fcb.pages.dev/`, "URL_HOSTNAME_MISMATCH"],
]) {
  assert.throws(() => exact(envelope({ canonical_deployment: deployment({ url }) })), (error) => error instanceof PagesProjectR2Error && error.jsonPath === "result.canonical_deployment.url" && error.diagnosticReference.includes(reason) && !error.diagnosticReference.includes(url));
}
assert.throws(() => fixedProjectR2GetRequest({ accountId: "bad" }), /PAGES_PROJECT_R2_TARGET_MISMATCH/);
const request = fixedProjectR2GetRequest({ accountId: "a".repeat(32) }); assert.equal(request.method, "GET"); assert.equal(new URL(request.url).pathname, `/client/v4/accounts/${"a".repeat(32)}/pages/projects/openglasshub`); assert.equal(new URL(request.url).search, ""); assert.equal(request.redirect, "error"); assert.equal(request.retryCount, 0);
let requests = 0;
const response = await executeFixedProjectR2Get({ accountId: "a".repeat(32), auth: { token: "test-token" }, environment: {}, fetchImpl: async () => { requests += 1; return new Response(bytes(envelope()), { status: 200 }); } });
assert.equal(requests, 1); assert.equal(createHash("sha256").update(response.raw).digest("hex"), parsePagesProjectR2Get(response.raw).rawResponseSha256);
await assert.rejects(executeFixedProjectR2Get({ accountId: "a".repeat(32), auth: { token: "test-token" }, environment: {}, fetchImpl: async () => { throw new Error("offline"); } }), /PAGES_PROJECT_R2_AUTH_TRANSPORT_UNAVAILABLE/);
console.log("PAGES_PROJECT_R2_GET_OK fake R1/R2 parsing, root-path normalization, value-blind structural URL diagnostics, strict project binding, fixed one-request transport, conflict policy, and zero-provider-network test passed");
