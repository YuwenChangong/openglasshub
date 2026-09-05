import { spawnSync } from "node:child_process";
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
process.exitCode = result.status ?? 1;
