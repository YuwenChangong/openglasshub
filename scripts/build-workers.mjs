import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";

const root = resolve(import.meta.dirname, "..");
const productionConfig = unstable_readConfig(
  { config: resolve(root, "wrangler.toml"), env: "production" },
  { hideWarnings: true },
);

const buildEnvironment = Object.fromEntries(
  Object.entries(productionConfig.vars ?? {}).filter(([name, value]) =>
    (name.startsWith("PUBLIC_") || name === "SITE_ORIGIN") && typeof value === "string" && value.trim() !== "",
  ),
);

const result = spawnSync(process.execPath, [resolve(root, "node_modules", "astro", "bin", "astro.mjs"), "build"], {
  cwd: root,
  env: { ...process.env, ...buildEnvironment },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const supabaseUrl = productionConfig.vars?.SUPABASE_URL;
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim() === "") {
    throw new Error("WORKERS_RUNTIME_SUPABASE_URL_MISSING");
  }

  const generatedPath = resolve(root, "dist", "server", "wrangler.json");
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  generated.vars = { ...(generated.vars ?? {}), SUPABASE_URL: supabaseUrl };
  await writeFile(generatedPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}
