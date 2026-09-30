import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(resolve(tmpdir(), "workers-build-context-"));
try {
  for (const file of ["scripts/build-workers.mjs", "scripts/lib/workers-runtime-vars.mjs", "src/lib/auth-captcha-mode.ts", "scripts/lib/workers-build-environment.mjs"]) {
    await mkdir(dirname(resolve(fixture, file)), { recursive: true });
    try { await copyFile(resolve(root, file), resolve(fixture, file)); }
    catch (error) { if (error.code !== "ENOENT" || !file.endsWith("workers-build-environment.mjs")) throw error; }
  }
  await mkdir(resolve(fixture, "node_modules/wrangler"), { recursive: true });
  await writeFile(resolve(fixture, "node_modules/wrangler/package.json"), JSON.stringify({ type: "module", exports: "./index.mjs" }));
  await writeFile(resolve(fixture, "node_modules/wrangler/index.mjs"), `
export function unstable_readConfig({ env }) {
  if (!["production", "preview"].includes(env)) throw new Error("UNEXPECTED_ENV");
  return { vars: { SUPABASE_URL: "https://example.invalid", SITE_ORIGIN: env,
    AUTH_CAPTCHA_MODE: env === "production" ? "prepare" : "off",
    PUBLIC_TURNSTILE_SITE_KEY: "fixture-upload-key",
    ...(env === "production" ? { PUBLIC_AUTH_TURNSTILE_SITE_KEY: "fixture-auth-key" } : {}) } };
}
`);
  await mkdir(resolve(fixture, "node_modules/astro/bin"), { recursive: true });
  await writeFile(resolve(fixture, "node_modules/astro/bin/astro.mjs"), `
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/wrangler.json", JSON.stringify({ vars: {
  BUILD_SOURCE_ENV: process.env.SITE_ORIGIN,
  BUILD_AUTH_SITEKEY_PRESENT: Boolean(process.env.PUBLIC_AUTH_TURNSTILE_SITE_KEY),
  PUBLIC_AUTH_TURNSTILE_SITE_KEY: "stale-generated-fixture"
} }));
`);
  const cleanEnv = { ...process.env };
  delete cleanEnv.WORKERS_CI;
  delete cleanEnv.WORKERS_CI_BRANCH;
  delete cleanEnv.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
  for (const [name, context, expected] of [
    ["LOCAL_DEFAULT_BUILD", {}, "production"],
    ["WORKERS_MAIN_TRUE", { WORKERS_CI: "true", WORKERS_CI_BRANCH: "main" }, "production"],
    ["WORKERS_MAIN_ONE", { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }, "production"],
    ["WORKERS_NON_MAIN_TRUE", { WORKERS_CI: "true", WORKERS_CI_BRANCH: "codex/feature" }, "preview"],
    ["WORKERS_NON_MAIN_ONE", { WORKERS_CI: "1", WORKERS_CI_BRANCH: "codex/feature" }, "preview"],
    ["PREVIEW_INHERITED_AUTH_KEY", { WORKERS_CI: "true", WORKERS_CI_BRANCH: "codex/feature", PUBLIC_AUTH_TURNSTILE_SITE_KEY: "stale-inherited-fixture" }, "preview"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/build-workers.mjs"], { cwd: fixture, env: { ...cleanEnv, ...context }, encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: wrapper must execute successfully`);
    const { vars } = JSON.parse(await readFile(resolve(fixture, "dist/server/wrangler.json"), "utf8"));
    assert.equal(vars.BUILD_SOURCE_ENV, expected, `${name}: actual wrapper selected environment`);
    assert.equal(vars.AUTH_CAPTCHA_MODE, expected === "production" ? "prepare" : "off", `${name}: runtime mode`);
    assert.equal(vars.BUILD_AUTH_SITEKEY_PRESENT, expected === "production", `${name}: build-time Auth key isolation`);
    assert.equal(Object.hasOwn(vars, "PUBLIC_AUTH_TURNSTILE_SITE_KEY"), expected === "production", `${name}: runtime Auth key isolation`);
    console.log(`${name}: PASS`);
  }
  for (const context of [
    { WORKERS_CI: "TRUE", WORKERS_CI_BRANCH: "main" },
    { WORKERS_CI: "false", WORKERS_CI_BRANCH: "main" },
    { WORKERS_CI: "true" },
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: "" },
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: " main " },
    { WORKERS_CI_BRANCH: "codex/feature" },
  ]) {
    const result = spawnSync(process.execPath, ["scripts/build-workers.mjs"], { cwd: fixture, env: { ...cleanEnv, ...context }, encoding: "utf8" });
    assert.notEqual(result.status, 0, "malformed explicit context must fail closed");
    assert.match(result.stderr, /WORKERS_BUILD_CONTEXT_INVALID/);
  }
  console.log("MALFORMED_CONTEXT_FAIL_CLOSED: PASS");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
