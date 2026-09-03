import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = await mkdtemp(join(tmpdir(), "openglass-workers-inventory-"));
const absentRoot = await mkdtemp(join(tmpdir(), "openglass-workers-inventory-absent-"));

async function fixtureFile(relativePath, contents, root = fixtureRoot) {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

try {
  await fixtureFile("wrangler.toml", `name = "fixture-worker"
pages_build_output_dir = "dist"
main = "dist/server/entry.mjs"

[[r2_buckets]]
binding = "MODERATION_ASSETS"
bucket_name = "private-media"

[[kv_namespaces]]
binding = "SESSION"
id = "private-kv-id"

[[d1_databases]]
binding = "DB"
database_id = "private-d1-id"

[vars]
SUPABASE_SECRET_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fixture.signature"
`);
  await fixtureFile("dist/server/wrangler.json", JSON.stringify({
    main: "entry.mjs",
    durable_objects: { bindings: [{ name: "COUNTER", class_name: "PrivateCounterClass" }] },
    services: [{ binding: "INTERNAL_API", service: "private-service-name" }],
  }));
  await fixtureFile("astro.config.mjs", "export default { site: 'https://openglasshub.pages.dev' };\n");
  await fixtureFile("scripts/smoke-production.mjs", "const url = 'https://openglasshub.pages.dev';\n");
  await fixtureFile("docs/release/historical.md", "Prior release: https://openglasshub.pages.dev\n");
  await fixtureFile("docs/operations.md", "Current operations target: https://openglasshub.pages.dev\n");
  await fixtureFile("docs/current-with-history.md", "# Current operations\n\nSee the historical receipt before using https://openglasshub.pages.dev.\n");
  await fixtureFile(".env.production", "SITE_URL=https://openglasshub.pages.dev\nSUPABASE_SECRET_KEY=private-value\n");
  await fixtureFile("config/deployment.settings", "origin=https://openglasshub.pages.dev\n");
  await fixtureFile("notes/current.txt", "Check https://openglasshub.pages.dev later.\n");
  await fixtureFile("src/pages/index.astro", "---\n---\n<h1>Home</h1>\n");
  await fixtureFile("src/pages/api/items.ts", "export const GET = () => new Response('ok');\n");
  await fixtureFile("src/pages/on-demand.astro", "---\nexport const prerender = false;\n---\n<h1>SSR</h1>\n");
  await fixtureFile("src/runtime.ts", `import { env as runtimeEnv } from "cloudflare:workers";
type RuntimeEnv = { DB: D1Database; COUNTER: DurableObjectNamespace; INTERNAL_API: Fetcher; MODERATION_ASSETS: R2Bucket; SESSION: KVNamespace };
const env = runtimeEnv as RuntimeEnv;
await env.DB.prepare("select 1");
await env.COUNTER.idFromName("fixture");
await env.INTERNAL_API.fetch("https://example.test");
await env.MODERATION_ASSETS.get("fixture");
await env.SESSION.get("fixture");
requireEnv(env, "R2_ACCESS_KEY_ID");
requireEnv(env, "R2_SECRET_ACCESS_KEY");
requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
`);
  await fixtureFile("wrangler.toml", "name = \"absent\"\n", absentRoot);

  const { collectRepositoryInventory, sanitizeProviderReceipt } = await import("./cloudflare-workers-migration-inventory.mjs");
  const inventory = await collectRepositoryInventory(fixtureRoot);

  assert.deepEqual(inventory.config.keyNames, ["d1_databases", "kv_namespaces", "main", "name", "pages_build_output_dir", "r2_buckets", "vars"]);
  assert.deepEqual(inventory.config.generatedConfigKeyNames, ["durable_objects", "main", "services"]);
  assert.deepEqual(inventory.bindings, [
    { environment: "generated", name: "COUNTER", type: "DURABLE_OBJECT" },
    { environment: "generated", name: "INTERNAL_API", type: "SERVICE" },
    { environment: "root", name: "DB", type: "D1" },
    { environment: "root", name: "SESSION", type: "KV" },
    { environment: "root", name: "MODERATION_ASSETS", type: "R2" },
  ]);
  assert.deepEqual(inventory.environmentVariableNames, [
    { environment: "root", name: "SUPABASE_SECRET_KEY" },
  ]);
  assert.equal(inventory.routes.pageFiles, 3);
  assert.equal(inventory.routes.apiRouteFiles, 1);
  assert.equal(inventory.routes.nonApiRouteFiles, 2);
  assert.deepEqual(Object.fromEntries(inventory.pagesUrlOccurrences.map(({ classification, path }) => [path, classification])), {
    ".env.production": "UNKNOWN_REQUIRES_REVIEW",
    "astro.config.mjs": "SWITCH_AFTER_WORKER_PASS",
    "config/deployment.settings": "UNKNOWN_REQUIRES_REVIEW",
    "docs/current-with-history.md": "UNKNOWN_REQUIRES_REVIEW",
    "docs/operations.md": "UNKNOWN_REQUIRES_REVIEW",
    "docs/release/historical.md": "KEEP_UNCHANGED",
    "notes/current.txt": "UNKNOWN_REQUIRES_REVIEW",
    "scripts/smoke-production.mjs": "ADD_NEW_URL_FIRST",
  });
  assert.deepEqual(inventory.runtime, {
    cloudflareWorkersImportPaths: ["src/runtime.ts"],
    optionalBindingUse: {
      D1: { configuredNames: ["DB"], sourcePaths: ["src/runtime.ts"], status: "PRESENT" },
      DURABLE_OBJECT: { configuredNames: ["COUNTER"], sourcePaths: ["src/runtime.ts"], status: "PRESENT" },
      SERVICE: { configuredNames: ["INTERNAL_API"], sourcePaths: ["src/runtime.ts"], status: "PRESENT" },
    },
    sourceBindingNames: [
      "COUNTER",
      "DB",
      "INTERNAL_API",
      "MODERATION_ASSETS",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "SESSION",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  });
  const absentInventory = await collectRepositoryInventory(absentRoot);
  assert.deepEqual(absentInventory.runtime, {
    cloudflareWorkersImportPaths: [],
    optionalBindingUse: {
      D1: { configuredNames: [], sourcePaths: [], status: "ABSENT" },
      DURABLE_OBJECT: { configuredNames: [], sourcePaths: [], status: "ABSENT" },
      SERVICE: { configuredNames: [], sourcePaths: [], status: "ABSENT" },
    },
    sourceBindingNames: [],
  });
  assert.doesNotMatch(JSON.stringify(inventory), /private-media|private-kv-id|private-d1-id|PrivateCounterClass|private-service-name|private-value|eyJhbGci/i);
  assert.throws(
    () => sanitizeProviderReceipt({ accountSubdomain: "example", token: "eyJhbGciOiJIUzI1NiJ9.payload.signature" }),
    /value-blind/i,
  );

  console.log("cloudflare-workers-migration-inventory: PASS");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(absentRoot, { recursive: true, force: true });
}
