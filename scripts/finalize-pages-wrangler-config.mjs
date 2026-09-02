import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function removePagesReservedAssetsBinding(workerConfig) {
  if (workerConfig.assets?.binding !== "ASSETS") {
    throw new Error("PAGES_RESERVED_ASSETS_BINDING_MISSING");
  }

  const { assets: _assets, ...pagesConfig } = workerConfig;
  return pagesConfig;
}

export async function finalizePagesWranglerConfig(configPath = resolve("dist/server/wrangler.json")) {
  const workerConfig = JSON.parse(await readFile(configPath, "utf8"));
  const pagesConfig = removePagesReservedAssetsBinding(workerConfig);
  await writeFile(configPath, JSON.stringify(pagesConfig));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await finalizePagesWranglerConfig();
  console.log("CLOUDFLARE_PAGES_WRANGLER_CONFIG_FINALIZED");
}
