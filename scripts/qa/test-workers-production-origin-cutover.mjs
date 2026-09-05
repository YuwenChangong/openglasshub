import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const OLD_ORIGIN = "https://openglasshub.liujinyi081.workers.dev";
const NEW_ORIGIN = "https://openglasshub.ogh.workers.dev";

const wrangler = await readFile(new URL("../../wrangler.toml", import.meta.url), "utf8");
const buildWrapper = await readFile(new URL("../build-workers.mjs", import.meta.url), "utf8");
const productionSection = wrangler.slice(wrangler.indexOf("[env.production.vars]"));
const siteOrigin = productionSection.match(/^SITE_ORIGIN\s*=\s*"([^"]+)"\s*$/m)?.[1];

assert.equal(siteOrigin, NEW_ORIGIN, "production SITE_ORIGIN must use the active ogh workers.dev hostname");
assert.equal(productionSection.includes(OLD_ORIGIN), false, "production non-secret configuration must not retain the old workers.dev hostname");
assert.match(buildWrapper, /name === "SITE_ORIGIN"/, "Workers build wrapper must materialize SITE_ORIGIN for canonical and SEO output");

console.log("workers-production-origin-cutover: PASS");
