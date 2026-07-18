import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseWranglerPagesDeployments, processEphemeralWranglerOutput, selectAttestableProductionDeployment,
  processWranglerCommandCapture, structuralDiagnostic, WranglerPagesDeploymentJsonError,
} from "./qa/parse-wrangler-pages-deployments.mjs";

const deployment = (patch = {}) => ({
  Id: "11111111-1111-4111-8111-111111111111", Environment: "Production", Branch: "main", Source: "b9ec4a0",
  Deployment: "https://6f11bcf1.openglasshub.pages.dev", Status: "just now", Build: "https://dash.cloudflare.com/example/pages/view/openglasshub/11111111-1111-4111-8111-111111111111", ...patch,
});
const bytes = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
const fails = (value, code) => assert.throws(() => parseWranglerPagesDeployments(bytes(value)), (error) => error instanceof WranglerPagesDeploymentJsonError && error.code === code);

const valid = parseWranglerPagesDeployments(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(` \n${JSON.stringify([deployment()])}\n `)]));
assert.equal(valid.deployments.length, 1);
assert.equal(valid.deployments[0].source, "b9ec4a0");
fails(null, "WRANGLER_JSON_TOP_LEVEL_NULL");
fails([], "WRANGLER_JSON_EMPTY_RESULT");
fails({ result: [] }, "WRANGLER_JSON_UNSUPPORTED_SHAPE");
fails("warning\n[]", "WRANGLER_JSON_UNSUPPORTED_SHAPE");
fails([null], "WRANGLER_JSON_MALFORMED_RECORD");
fails([deployment({ Id: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Environment: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Deployment: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Branch: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Source: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Source: "b9ec4" })], "WRANGLER_JSON_MALFORMED_RECORD");
fails([deployment({ Status: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Build: null })], "WRANGLER_JSON_REQUIRED_FIELD_MISSING");
fails([deployment({ Id: "not-a-deployment-id" })], "WRANGLER_JSON_MALFORMED_RECORD");
fails([deployment(), deployment()], "WRANGLER_JSON_DUPLICATE_DEPLOYMENT_ID");
const preview = parseWranglerPagesDeployments(bytes([deployment({ Environment: "Preview" })]));
assert.throws(() => selectAttestableProductionDeployment(preview, { projectName: "openglasshub", environment: "production", canonicalBaseUrl: "https://openglasshub.pages.dev", sourceCommit: "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6" }), /WRANGLER_JSON_DEPLOYMENT_NOT_FOUND/);
const wrongProjectUrl = parseWranglerPagesDeployments(bytes([deployment({ Deployment: "https://evil.example/" })]));
assert.throws(() => selectAttestableProductionDeployment(wrongProjectUrl, { projectName: "openglasshub", environment: "production", canonicalBaseUrl: "https://openglasshub.pages.dev", sourceCommit: "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6" }), /WRANGLER_JSON_DEPLOYMENT_NOT_FOUND/);
assert.throws(() => selectAttestableProductionDeployment(valid, { projectName: "openglasshub", environment: "production", canonicalBaseUrl: "https://openglasshub.pages.dev", sourceCommit: "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6" }), /WRANGLER_JSON_REQUIRED_FIELD_MISSING/);
const diagnostic = structuralDiagnostic(bytes({ result: null, items: [{ id: "private-value", nested: null }] }));
assert.equal(diagnostic.structure.some((entry) => entry.includes("private-value")), false);
assert.equal(diagnostic.structure.some((entry) => entry.includes("null")), true);
assert.equal(structuralDiagnostic(bytes("warning")).classification, "WRANGLER_JSON_UNSUPPORTED_SHAPE");
const stderrWarning = processWranglerCommandCapture({ exitCode: 0, stdout: bytes([deployment()]), stderr: bytes("non-secret warning") });
assert.equal(stderrWarning.classification, "WRANGLER_JSON_PARSE_OK");
assert.equal(Object.values(stderrWarning.capture).some((entry) => String(entry).includes("warning")), false);
assert.equal(processWranglerCommandCapture({ exitCode: 1, stdout: bytes([deployment()]), stderr: bytes("failure") }).classification, "WRANGLER_JSON_UNSUPPORTED_SHAPE");

const root = await mkdtemp(path.join(os.tmpdir(), "wrangler-pages-json-"));
try {
  const good = path.join(root, "good.json"); await writeFile(good, bytes([deployment()]));
  const goodResult = await processEphemeralWranglerOutput(good);
  assert.equal(goodResult.classification, "WRANGLER_JSON_PARSE_OK"); await assert.rejects(readFile(good), /ENOENT/);
  const bad = path.join(root, "bad.json"); await writeFile(bad, bytes({ result: null }));
  const badResult = await processEphemeralWranglerOutput(bad);
  assert.equal(badResult.classification, "WRANGLER_JSON_UNSUPPORTED_SHAPE"); await assert.rejects(readFile(bad), /ENOENT/);
  const nullArray = path.join(root, "null-array.json"); await writeFile(nullArray, bytes([null]));
  const nullArrayResult = await processEphemeralWranglerOutput(nullArray);
  assert.equal(nullArrayResult.classification, "WRANGLER_JSON_MALFORMED_RECORD"); await assert.rejects(readFile(nullArray), /ENOENT/);
} finally { await rm(root, { recursive: true, force: true }); }

console.log("WRANGLER_PAGES_DEPLOYMENTS_PARSER_OK source-proven array shape, null safety, diagnostics, selection refusal, and raw-file lifecycle passed with zero network");
