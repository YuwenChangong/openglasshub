import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { collectRepositoryInventory } from "./cloudflare-workers-migration-inventory.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const inventory = await collectRepositoryInventory(root);

assert.equal(
  inventory.config.keyNames.includes("pages_build_output_dir"),
  false,
  "the root Wrangler configuration must not select the Cloudflare Pages build contract",
);
assert.equal(packageJson.scripts.build, "astro build", "npm run build must be the canonical Astro build without a Pages finalizer");
assert.equal(
  packageJson.scripts["test:workers-config"],
  "node scripts/qa/test-workers-native-config.mjs",
  "package.json must expose the focused Workers configuration test",
);

const rootBindings = new Set(
  inventory.bindings
    .filter(({ environment }) => environment === "root")
    .map(({ name }) => name),
);
assert.equal(rootBindings.has("MODERATION_ASSETS"), true, "the root R2 binding name must remain MODERATION_ASSETS");
assert.equal(rootBindings.has("SESSION"), true, "the root KV binding name must remain SESSION");

const generatedPath = resolve(root, "dist", "server", "wrangler.json");
const generated = JSON.parse(await readFile(generatedPath, "utf8"));

assert.equal("pages_build_output_dir" in generated, false, "the Astro-generated deployment config must be Worker-shaped");
assert.equal(typeof generated.main, "string", "the Astro-generated deployment config must declare a Worker entrypoint");
assert.notEqual(generated.main.trim(), "", "the generated Worker entrypoint must not be empty");
assert.equal(generated.assets?.binding, "ASSETS", "the generated config must retain Astro's static-assets binding");
assert.equal(typeof generated.assets?.directory, "string", "the generated config must declare its static-assets directory");
assert.notEqual(generated.assets.directory.trim(), "", "the generated static-assets directory must not be empty");
assert.equal(Array.isArray(generated.rules), true, "the generated config must include Worker module rules");
assert.equal(generated.rules.length > 0, true, "the generated config must include at least one Worker module rule");
for (const rule of generated.rules) {
  assert.equal(typeof rule.type, "string", "every generated module rule must declare a type");
  assert.equal(Array.isArray(rule.globs), true, "every generated module rule must declare globs");
  assert.equal(rule.globs.length > 0, true, "every generated module rule must include at least one glob");
}

const generatedBindings = new Set([
  ...(generated.r2_buckets ?? []).map(({ binding }) => binding),
  ...(generated.kv_namespaces ?? []).map(({ binding }) => binding),
]);
assert.equal(generatedBindings.has("MODERATION_ASSETS"), true, "the generated config must retain the R2 binding name");
assert.equal(generatedBindings.has("SESSION"), true, "the generated config must retain the KV binding name");

console.log("workers-native-config: PASS");
