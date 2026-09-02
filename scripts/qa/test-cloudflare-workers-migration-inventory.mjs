import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = await mkdtemp(join(tmpdir(), "openglass-workers-inventory-"));

async function fixtureFile(relativePath, contents) {
  const target = join(fixtureRoot, relativePath);
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

[vars]
SUPABASE_SECRET_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fixture.signature"
`);
  await fixtureFile("astro.config.mjs", "export default { site: 'https://openglasshub.pages.dev' };\n");
  await fixtureFile("scripts/smoke-production.mjs", "const url = 'https://openglasshub.pages.dev';\n");
  await fixtureFile("docs/release/historical.md", "Prior release: https://openglasshub.pages.dev\n");
  await fixtureFile("notes/current.txt", "Check https://openglasshub.pages.dev later.\n");
  await fixtureFile("src/pages/index.astro", "---\n---\n<h1>Home</h1>\n");
  await fixtureFile("src/pages/api/items.ts", "export const GET = () => new Response('ok');\n");
  await fixtureFile("src/pages/on-demand.astro", "---\nexport const prerender = false;\n---\n<h1>SSR</h1>\n");

  const { collectRepositoryInventory, sanitizeProviderReceipt } = await import("./cloudflare-workers-migration-inventory.mjs");
  const inventory = await collectRepositoryInventory(fixtureRoot);

  assert.deepEqual(inventory.config.keyNames, ["kv_namespaces", "main", "name", "pages_build_output_dir", "r2_buckets", "vars"]);
  assert.deepEqual(inventory.bindings, [
    { environment: "root", name: "SESSION", type: "KV" },
    { environment: "root", name: "MODERATION_ASSETS", type: "R2" },
  ]);
  assert.deepEqual(inventory.environmentVariableNames, [
    { environment: "root", name: "SUPABASE_SECRET_KEY" },
  ]);
  assert.equal(inventory.routes.pageFiles, 3);
  assert.equal(inventory.routes.apiRouteFiles, 1);
  assert.equal(inventory.routes.nonApiRouteFiles, 2);
  assert.deepEqual(
    inventory.pagesUrlOccurrences.map(({ classification, path }) => ({ classification, path })),
    [
      { classification: "SWITCH_AFTER_WORKER_PASS", path: "astro.config.mjs" },
      { classification: "KEEP_UNCHANGED", path: "docs/release/historical.md" },
      { classification: "UNKNOWN_REQUIRES_REVIEW", path: "notes/current.txt" },
      { classification: "ADD_NEW_URL_FIRST", path: "scripts/smoke-production.mjs" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(inventory), /private-media|private-kv-id|eyJhbGci/i);
  assert.throws(
    () => sanitizeProviderReceipt({ accountSubdomain: "example", token: "eyJhbGciOiJIUzI1NiJ9.payload.signature" }),
    /value-blind/i,
  );

  console.log("cloudflare-workers-migration-inventory: PASS");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
