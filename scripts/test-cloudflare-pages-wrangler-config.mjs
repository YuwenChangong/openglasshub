import assert from "node:assert/strict";
import { removePagesReservedAssetsBinding } from "./finalize-pages-wrangler-config.mjs";

const generatedWorkerConfig = {
  name: "openglasshub",
  main: "entry.mjs",
  assets: {
    binding: "ASSETS",
    directory: "../client",
  },
  kv_namespaces: [{ binding: "SESSION" }],
};

const pagesConfig = removePagesReservedAssetsBinding(generatedWorkerConfig);

assert.equal("assets" in pagesConfig, false);
assert.deepEqual(pagesConfig.kv_namespaces, [{ binding: "SESSION" }]);
assert.equal(generatedWorkerConfig.assets.binding, "ASSETS");

console.log("CLOUDFLARE_PAGES_WRANGLER_CONFIG=PASS");
