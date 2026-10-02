import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { unstable_readConfig } from "wrangler";

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
    AUTH_CAPTCHA_MODE: env === "production" ? "required" : "off",
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
  BUILD_SITE_ORIGIN: process.env.SITE_ORIGIN,
  BUILD_PUBLIC_R2_BASE: process.env.PUBLIC_R2_PUBLIC_BASE_URL,
  BUILD_PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL,
  BUILD_PUBLIC_ANON_PRESENT: Boolean(process.env.PUBLIC_SUPABASE_ANON_KEY),
  BUILD_UNSAFE_ENV_PRESENT: ["P9_PRODUCTION_DATABASE_URL", "POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE", "SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "CLOUDFLARE_API_TOKEN", "BREVO_API_KEY"].some(name => Boolean(process.env[name])),
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
    assert.equal(vars.AUTH_CAPTCHA_MODE, expected === "production" ? "required" : "off", `${name}: runtime mode`);
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

  const configs = Object.fromEntries(["preview", "production"].map((env) => {
    const { vars } = unstable_readConfig({ config: resolve(root, "wrangler.toml"), env }, { hideWarnings: true });
    const names = ["SUPABASE_URL", "SITE_ORIGIN", "PUBLIC_R2_PUBLIC_BASE_URL", "AUTH_CAPTCHA_MODE", "PUBLIC_AUTH_TURNSTILE_SITE_KEY", "PUBLIC_TURNSTILE_SITE_KEY"];
    return [env, { vars: Object.fromEntries(names.filter((name) => Object.hasOwn(vars, name)).map((name) => [name, vars[name]])) }];
  }));
  const productionVars = configs.production.vars;
  assert.equal(productionVars.SITE_ORIGIN, "https://openglasshub.ogh.workers.dev");
  assert.ok(typeof productionVars.PUBLIC_R2_PUBLIC_BASE_URL === "string" && productionVars.PUBLIC_R2_PUBLIC_BASE_URL.trim());
  await writeFile(resolve(fixture, "node_modules/wrangler/config-fixture.json"), JSON.stringify(configs));
  await writeFile(resolve(fixture, "node_modules/wrangler/index.mjs"), `
import { readFileSync } from "node:fs";
const configs = JSON.parse(readFileSync(new URL("./config-fixture.json", import.meta.url), "utf8"));
export function unstable_readConfig({ env }) { return configs[env]; }
`);
  delete cleanEnv.SITE_ORIGIN;
  delete cleanEnv.PUBLIC_R2_PUBLIC_BASE_URL;
  for (const [name, context, expected] of [
    ["REAL_LOCAL_DEFAULT", {}, "production"],
    ["REAL_WORKERS_MAIN", { WORKERS_CI: "true", WORKERS_CI_BRANCH: "main" }, "production"],
    ["REAL_WORKERS_PREVIEW", { WORKERS_CI: "1", WORKERS_CI_BRANCH: "codex/feature", PUBLIC_AUTH_TURNSTILE_SITE_KEY: "stale-inherited-fixture" }, "preview"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/build-workers.mjs"], { cwd: fixture, env: { ...cleanEnv, ...context }, encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: wrapper executes with reviewed source config`);
    const { vars } = JSON.parse(await readFile(resolve(fixture, "dist/server/wrangler.json"), "utf8"));
    assert.equal(vars.BUILD_SITE_ORIGIN, productionVars.SITE_ORIGIN, `${name}: canonical origin reaches Astro`);
    assert.equal(vars.BUILD_PUBLIC_R2_BASE, productionVars.PUBLIC_R2_PUBLIC_BASE_URL, `${name}: shared public R2 base reaches Astro`);
    assert.equal(vars.AUTH_CAPTCHA_MODE, expected === "preview" ? "off" : "required");
    assert.equal(vars.BUILD_AUTH_SITEKEY_PRESENT, expected === "production");
    assert.equal(Object.hasOwn(vars, "PUBLIC_AUTH_TURNSTILE_SITE_KEY"), expected === "production");
    console.log(`${name}_SHARED_PUBLIC_VARS_AND_AUTH_ISOLATION: PASS`);
  }

  await writeFile(resolve(fixture, "node_modules/wrangler/index.mjs"), `
import { readFileSync } from "node:fs";
const configs = JSON.parse(readFileSync(new URL("./config-fixture.json", import.meta.url), "utf8"));
export function unstable_readConfig({ config, env }) {
  if (config.endsWith("wrangler.toml")) return configs[env];
  return JSON.parse(readFileSync(config, "utf8"));
}
`);
  const localVars = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    PUBLIC_SUPABASE_ANON_KEY: "owned-dummy-local-anon",
    SITE_ORIGIN: "https://127.0.0.1:8443",
    AUTH_CAPTCHA_MODE: "off",
  };
  const localConfig = resolve(fixture, "owned-local-config.json");
  const poisoned = { ...cleanEnv,
    PUBLIC_SUPABASE_URL: "https://inherited.invalid", PUBLIC_SUPABASE_ANON_KEY: "inherited-dummy",
    PUBLIC_R2_PUBLIC_BASE_URL: "https://inherited-assets.invalid", PUBLIC_TURNSTILE_SITE_KEY: "inherited-widget",
    PUBLIC_AUTH_TURNSTILE_SITE_KEY: "inherited-auth-widget", SUPABASE_URL: "https://inherited.invalid",
    P9_PRODUCTION_DATABASE_URL: "unsafe-test-marker", SUPABASE_SERVICE_ROLE_KEY: "unsafe-test-marker",
    CLOUDFLARE_API_TOKEN: "unsafe-test-marker", BREVO_API_KEY: "unsafe-test-marker",
  };
  await writeFile(localConfig, JSON.stringify({ vars: localVars }));
  const local = spawnSync(process.execPath, ["scripts/build-workers.mjs", "--local-config", localConfig], { cwd: fixture, env: poisoned, encoding: "utf8" });
  assert.equal(local.status, 0, "LOCAL_CONFIG_BUILD_SUCCESS");
  const { vars: localOutput } = JSON.parse(await readFile(resolve(fixture, "dist/server/wrangler.json"), "utf8"));
  assert.equal(localOutput.BUILD_PUBLIC_SUPABASE_URL, localVars.PUBLIC_SUPABASE_URL, "LOCAL_CONFIG_PUBLIC_ORIGIN_REACHES_ASTRO");
  assert.equal(localOutput.BUILD_SITE_ORIGIN, localVars.SITE_ORIGIN);
  assert.equal(localOutput.SUPABASE_URL, localVars.SUPABASE_URL);
  assert.equal(localOutput.BUILD_PUBLIC_ANON_PRESENT, true);
  assert.equal(localOutput.BUILD_PUBLIC_R2_BASE, undefined);
  assert.equal(localOutput.BUILD_UNSAFE_ENV_PRESENT, false);
  assert.equal(localOutput.BUILD_AUTH_SITEKEY_PRESENT, false);
  assert.equal(localOutput.AUTH_CAPTCHA_MODE, "off");
  assert.equal(Object.hasOwn(localOutput, "PUBLIC_AUTH_TURNSTILE_SITE_KEY"), false);
  console.log("LOCAL_CONFIG_CHILD_AND_RUNTIME_ISOLATION: PASS");
  for (const [name, patch, code] of [
    ["PUBLIC_REMOTE", { PUBLIC_SUPABASE_URL: "https://example.invalid" }, "LOCAL_BUILD_PUBLIC_REMOTE_TARGET"],
    ["SERVER_REMOTE", { SUPABASE_URL: "https://example.invalid" }, "LOCAL_BUILD_TARGET_INVALID"],
    ["SITE_REMOTE", { SITE_ORIGIN: "https://example.invalid" }, "LOCAL_BUILD_TARGET_INVALID"],
    ["R2_REMOTE", { PUBLIC_R2_PUBLIC_BASE_URL: "https://example.invalid" }, "LOCAL_BUILD_PUBLIC_REMOTE_TARGET"],
    ["WS_REMOTE", { PUBLIC_WEBSOCKET_URL: "wss://example.invalid" }, "LOCAL_BUILD_PUBLIC_REMOTE_TARGET"],
    ["ROLE_PRESENT", { SUPABASE_SERVICE_ROLE_KEY: "" }, "LOCAL_BUILD_PRIVILEGED_VAR"],
    ["DATABASE_PRESENT", { DATABASE_URL: "dummy-test-marker" }, "LOCAL_BUILD_PRIVILEGED_VAR"],
    ["LOCALHOST", { SUPABASE_URL: "http://localhost:54321" }, "LOCAL_BUILD_TARGET_INVALID"],
    ["OTHER_LOOPBACK", { SUPABASE_URL: "http://127.0.0.2:54321" }, "LOCAL_BUILD_TARGET_INVALID"],
    ["SITE_HTTP", { SITE_ORIGIN: "http://127.0.0.1:8443" }, "LOCAL_BUILD_TARGET_INVALID"],
    ["TARGET_MISMATCH", { SUPABASE_URL: "http://127.0.0.1:54322" }, "LOCAL_BUILD_ORIGIN_MISMATCH"],
    ["ANON_EMPTY", { PUBLIC_SUPABASE_ANON_KEY: "" }, "LOCAL_BUILD_REQUIRED_VAR"],
    ["AUTH_REQUIRED", { AUTH_CAPTCHA_MODE: "required" }, "LOCAL_BUILD_AUTH_MODE"],
    ["AUTH_SITEKEY_PRESENT", { PUBLIC_AUTH_TURNSTILE_SITE_KEY: "" }, "LOCAL_BUILD_AUTH_SITEKEY"],
  ]) {
    await writeFile(localConfig, JSON.stringify({ vars: { ...localVars, ...patch } }));
    const denied = spawnSync(process.execPath, ["scripts/build-workers.mjs", "--local-config", localConfig], { cwd: fixture, env: cleanEnv, encoding: "utf8" });
    assert.notEqual(denied.status, 0, name);
    assert.ok(denied.stderr.includes(code), `${name}: safe failure code required`);
    assert.equal(denied.stderr.includes("dummy-test-marker"), false);
    console.log(`${name}_FAIL_CLOSED: PASS`);
  }
  for (const args of [["--local-config", "relative.json"], ["--local-config"], ["--config", localConfig], ["--local-config", localConfig, "--extra"]]) {
    const denied = spawnSync(process.execPath, ["scripts/build-workers.mjs", ...args], { cwd: fixture, env: cleanEnv, encoding: "utf8" });
    assert.notEqual(denied.status, 0);
    assert.ok(denied.stderr.includes("LOCAL_BUILD_CONFIG_PATH") || denied.stderr.includes("WORKERS_BUILD_ARGUMENTS_INVALID"));
  }
  console.log("LOCAL_CONFIG_ARGUMENTS_FAIL_CLOSED: PASS");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
