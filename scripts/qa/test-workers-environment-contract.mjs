import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const source = await readFile(resolve(root, "wrangler.toml"), "utf8");
const generated = JSON.parse(await readFile(resolve(root, "dist", "server", "wrangler.json"), "utf8"));

function productionValue(name) {
  const section = source.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  const match = section.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, "m"));
  assert.ok(match, `WORKERS_PRODUCTION_CONFIG_${name}_MISSING`);
  return match[1];
}

const buildTimePublicNames = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "PUBLIC_TURNSTILE_SITE_KEY",
  "PUBLIC_R2_PUBLIC_BASE_URL",
  "SITE_ORIGIN",
];

for (const name of buildTimePublicNames) productionValue(name);

assert.deepEqual(generated.vars ?? {}, {}, "generated Worker config must keep provider runtime vars value-blind");

const clientFiles = await (await import("node:fs/promises")).readdir(resolve(root, "dist", "client"), { recursive: true });
const clientJavaScript = await Promise.all(
  clientFiles
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFile(resolve(root, "dist", "client", path), "utf8")),
);
const clientOutput = clientJavaScript.join("\n");

assert.equal(
  clientOutput.includes(productionValue("PUBLIC_SUPABASE_URL")),
  true,
  "BUILT_CLIENT_SUPABASE_ORIGIN_PRESENT",
);
assert.equal(
  clientOutput.includes(productionValue("PUBLIC_R2_PUBLIC_BASE_URL")),
  true,
  "BUILT_CLIENT_R2_PUBLIC_BASE_PRESENT",
);
assert.equal(clientOutput.includes("SUPABASE_SERVICE_ROLE_KEY"), false, "BUILT_CLIENT_SERVICE_ROLE_LEAK");

console.log("workers-environment-contract: PASS");
