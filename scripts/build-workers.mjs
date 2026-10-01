import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";
import { withWorkerRuntimeVars } from "./lib/workers-runtime-vars.mjs";
import { resolveWorkersBuildEnvironment } from "./lib/workers-build-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceConfig = unstable_readConfig(
  { config: resolve(root, "wrangler.toml"), env: resolveWorkersBuildEnvironment(process.env) },
  { hideWarnings: true },
);

const buildEnvironment = Object.fromEntries(
  Object.entries(sourceConfig.vars ?? {}).filter(([name, value]) =>
    (name.startsWith("PUBLIC_") || name === "SITE_ORIGIN") && typeof value === "string" && value.trim() !== "",
  ),
);

// An absent source binding must not inherit a production Auth key from the caller.
const childEnvironment = { ...process.env, ...buildEnvironment };
if (!Object.hasOwn(buildEnvironment, "PUBLIC_AUTH_TURNSTILE_SITE_KEY")) {
  delete childEnvironment.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
}

const result = spawnSync(process.execPath, [resolve(root, "node_modules", "astro", "bin", "astro.mjs"), "build"], {
  cwd: root,
  env: childEnvironment,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const generatedPath = resolve(root, "dist", "server", "wrangler.json");
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  const configured = withWorkerRuntimeVars(generated, sourceConfig.vars ?? {});
  await writeFile(generatedPath, `${JSON.stringify(configured, null, 2)}\n`, "utf8");
}
