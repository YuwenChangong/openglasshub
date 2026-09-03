#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../../node_modules/astro/dist/core/config/config.js";

import {
  LEGACY_PAGES_ORIGIN,
  resolveSiteOrigin,
} from "../../src/lib/site-origin.ts";

const WORKER_TEST_ORIGIN = "https://openglass-hub-transition-test.workers.dev";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function loadAstroConfig() {
  const result = await resolveConfig({ root: repositoryRoot }, "build");
  return result.userConfig;
}

assert.equal(LEGACY_PAGES_ORIGIN, "https://openglasshub.pages.dev");
assert.equal(resolveSiteOrigin(undefined), LEGACY_PAGES_ORIGIN);
assert.equal(resolveSiteOrigin(""), LEGACY_PAGES_ORIGIN);
assert.equal(resolveSiteOrigin("   "), LEGACY_PAGES_ORIGIN);
assert.equal(resolveSiteOrigin(`${LEGACY_PAGES_ORIGIN}/`), LEGACY_PAGES_ORIGIN);
assert.equal(resolveSiteOrigin(`${WORKER_TEST_ORIGIN}/`), WORKER_TEST_ORIGIN);

for (const invalidOrigin of [
  "http://openglasshub.pages.dev",
  "//openglasshub.pages.dev",
  "openglasshub.pages.dev",
  `${WORKER_TEST_ORIGIN}/preview`,
  `${WORKER_TEST_ORIGIN}?preview=1`,
  `${WORKER_TEST_ORIGIN}#preview`,
  `https://user:secret@${new URL(WORKER_TEST_ORIGIN).host}`,
  `${WORKER_TEST_ORIGIN},${LEGACY_PAGES_ORIGIN}`,
]) {
  assert.throws(
    () => resolveSiteOrigin(invalidOrigin),
    /absolute HTTPS origin/,
    `must reject non-canonical origin value: ${invalidOrigin}`,
  );
}

const originalSiteOrigin = process.env.SITE_ORIGIN;

try {
  delete process.env.SITE_ORIGIN;
  const defaultConfig = await loadAstroConfig();
  assert.equal(defaultConfig.site, LEGACY_PAGES_ORIGIN);

  process.env.SITE_ORIGIN = `${WORKER_TEST_ORIGIN}/`;
  const workerConfig = await loadAstroConfig();
  assert.equal(workerConfig.site, WORKER_TEST_ORIGIN);
  assert.notEqual(workerConfig.site, LEGACY_PAGES_ORIGIN);
} finally {
  if (originalSiteOrigin === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = originalSiteOrigin;
}

for (const script of ["scripts/smoke-production.mjs", "scripts/post-launch-check.mjs"]) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, "--url", "http://127.0.0.1:1"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.notEqual(result.status, 0, `${script} must reject an invalid explicit URL`);
  assert.match(result.stderr, /absolute HTTPS origin/, `${script} must fail during origin validation`);
}

const finalAuditResult = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "scripts/final-audit.cjs"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, SITE_ORIGIN: "http://127.0.0.1:1" },
    timeout: 10_000,
  },
);
assert.notEqual(finalAuditResult.status, 0, "final audit must reject an invalid configured origin");
assert.match(finalAuditResult.stderr, /absolute HTTPS origin/, "final audit must use shared origin validation");

console.log(JSON.stringify({
  status: "PASS",
  defaultOrigin: LEGACY_PAGES_ORIGIN,
  configurableOrigin: WORKER_TEST_ORIGIN,
  invalidOriginsRejected: 8,
  canonicalOriginsPerBuild: 1,
  explicitUrlConsumersValidated: 2,
  auditOriginValidation: true,
}));
