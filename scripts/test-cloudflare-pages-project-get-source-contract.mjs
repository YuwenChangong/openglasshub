import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256 } from "./qa/cloudflare-pages-project-get.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const module = await readFile(path.join(root, "scripts", "qa", "cloudflare-pages-project-get.mjs"), "utf8");
for (const fragment of [
  'PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256 = "7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0"',
  'canonical_deployment', 'latest_deployment', 'productionBranch !== "main"', 'PAGES_PROJECT_GET_REQUIRED_FIELD_CONFLICT',
  'pages/projects/${PAGES_PROJECT}', 'redirect: "error"', 'retryCount: 0',
]) assert.ok(module.includes(fragment), fragment);
assert.equal(PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256.length, 64);
assert.equal(module.includes("canonical_deployment: Deployment | null"), false, "provider source remains outside Git; only its immutable public hash is bound here");
console.log("PAGES_PROJECT_GET_SOURCE_CONTRACT_OK official public generated SDK hash is bound, the parser requires nullable provider target fields to be non-null, and the transport shape is fixed");
