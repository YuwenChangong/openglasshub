import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const modulePath = resolve(import.meta.dirname, "lib/workers-runtime-vars.mjs");
assert.equal(await access(modulePath).then(() => true, () => false), true, "Worker runtime var mapping must exist");
const { withWorkerRuntimeVars } = await import("./lib/workers-runtime-vars.mjs");

const generated = {
  main: "server/entry.mjs",
  assets: { binding: "ASSETS" },
  vars: { EXISTING_BUILD_VAR: "retained", PUBLIC_AUTH_TURNSTILE_SITE_KEY: "stale" },
};
const source = { SUPABASE_URL: "https://example.invalid", AUTH_CAPTCHA_MODE: "off", SUPABASE_SERVICE_ROLE_KEY: "must-not-copy" };

const off = withWorkerRuntimeVars(generated, source);
assert.deepEqual(off, {
  main: "server/entry.mjs",
  assets: { binding: "ASSETS" },
  vars: { EXISTING_BUILD_VAR: "retained", SUPABASE_URL: "https://example.invalid", AUTH_CAPTCHA_MODE: "off" },
});
assert.equal(generated.vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, "stale", "mapping does not mutate the generated input");

for (const mode of ["prepare", "required"]) {
  const mapped = withWorkerRuntimeVars(generated, {
    ...source,
    AUTH_CAPTCHA_MODE: mode,
    PUBLIC_AUTH_TURNSTILE_SITE_KEY: "public-auth-test-key",
  });
  assert.equal(mapped.vars.AUTH_CAPTCHA_MODE, mode);
  assert.equal(mapped.vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, "public-auth-test-key");
  assert.equal(Object.hasOwn(mapped.vars, "SUPABASE_SERVICE_ROLE_KEY"), false);
}

assert.equal(withWorkerRuntimeVars(generated, { ...source, AUTH_CAPTCHA_MODE: undefined }).vars.AUTH_CAPTCHA_MODE, "off");
assert.equal(withWorkerRuntimeVars(generated, { ...source, PUBLIC_AUTH_TURNSTILE_SITE_KEY: "" }).vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, undefined);
assert.throws(() => withWorkerRuntimeVars(generated, { ...source, AUTH_CAPTCHA_MODE: "OFF" }), /AUTH_CAPTCHA_MODE_INVALID/);
assert.throws(() => withWorkerRuntimeVars(generated, { ...source, SUPABASE_URL: "" }), /WORKERS_RUNTIME_SUPABASE_URL_MISSING/);

console.log("build workers runtime vars: PASS");
await import("./test-build-workers-environment.mjs");
