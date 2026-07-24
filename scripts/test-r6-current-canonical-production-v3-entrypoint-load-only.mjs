import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ENTRYPOINT_LOAD_ONLY, R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OPERATION, isCurrentCanonicalProductionV3MetadataEntrypoint } from "./qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = new URL("./qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs", import.meta.url).href;
assert.equal(isCurrentCanonicalProductionV3MetadataEntrypoint(undefined), false);
assert.equal(R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OPERATION, "PREPARE_CURRENT_CANONICAL_PRODUCTION_V3_AUTH_DRY_RUN_ATTESTATION");
const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `import { R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ENTRYPOINT_LOAD_ONLY } from ${JSON.stringify(moduleUrl)}; process.stdout.write(R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ENTRYPOINT_LOAD_ONLY);`], { cwd: path.join(root, "scripts"), encoding: "utf8", timeout: 2000, env: { PATH: process.env.PATH } });
assert.equal(probe.status, 0); assert.equal(probe.stdout, R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ENTRYPOINT_LOAD_ONLY); assert.equal(probe.stderr, "");
console.log("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_METADATA_ENTRYPOINT_LOAD_ONLY_OK imports only, accepts no flags, resolves no account, prompts no input, writes no evidence, and performs zero network");
