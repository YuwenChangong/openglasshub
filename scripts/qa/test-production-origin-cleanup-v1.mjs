import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workerOrigin = "https://openglasshub.ogh.workers.dev";
const legacyOrigin = "https://openglasshub.pages.dev";
const guidance = await readFile(new URL("../../src/content/docs/about/search-console-launch-checklist.mdx", import.meta.url), "utf8");
const canary = await readFile(new URL("./run-production-minimal-canary.mjs", import.meta.url), "utf8");

test("public Search Console guidance uses Worker", () => {
  assert.ok(guidance.includes(`当前生产地址使用 \`${workerOrigin}\``));
  assert.ok(guidance.includes(`${workerOrigin}/sitemap-index.xml`));
  assert.equal(guidance.includes(legacyOrigin), false);
});

test("minimal canary canonical target is Worker", () => {
  assert.match(canary, /const CANONICAL_PRODUCTION_URL = "https:\/\/openglasshub\.ogh\.workers\.dev";/);
});

const env = { ...process.env };
delete env.BASE_URL;
delete env.ADMIN_BEARER;
test("production smoke fails closed without an explicit target", () => {
  const missingTarget = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/smoke-production.mjs"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.notEqual(missingTarget.status, 0);
  assert.ok(missingTarget.stderr.includes("SMOKE_PRODUCTION_BASE_URL_REQUIRED"));
  assert.equal(missingTarget.stdout, "");
});

test("post-launch check fails closed without an explicit target", () => {
  const missingTarget = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/post-launch-check.mjs"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.notEqual(missingTarget.status, 0);
  assert.ok(missingTarget.stderr.includes("POST_LAUNCH_BASE_URL_REQUIRED"));
  assert.equal(missingTarget.stdout, "");
});
