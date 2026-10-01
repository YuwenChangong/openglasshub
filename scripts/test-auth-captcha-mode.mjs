import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "@astrojs/compiler";
import { unstable_readConfig } from "wrangler";

const root = resolve(import.meta.dirname, "..");
const parserPath = resolve(root, "src/lib/auth-captcha-mode.ts");
assert.equal(await access(parserPath).then(() => true, () => false), true, "auth CAPTCHA mode parser must exist");
const { parseAuthCaptchaMode } = await import("../src/lib/auth-captcha-mode.ts");

assert.equal(parseAuthCaptchaMode(undefined), "off", "absent mode defaults to off");
for (const mode of ["off", "prepare", "required"]) {
  assert.equal(parseAuthCaptchaMode(mode), mode, `explicit ${mode} mode passes through`);
}
for (const invalid of ["", "OFF", "required ", "disabled", null, 1]) {
  assert.throws(
    () => parseAuthCaptchaMode(invalid),
    (error) => error instanceof Error && error.message === "AUTH_CAPTCHA_MODE_INVALID",
    "invalid explicit mode fails with a bounded configuration error",
  );
}
console.log("auth captcha mode parser: PASS");

const route = await readFile(resolve(root, "src/pages/login/index.astro"), "utf8");
await parse(route);
assert.match(route, /import\s*\{\s*env\s+as\s+runtimeEnv\s*\}\s*from\s*["']cloudflare:workers["']/);
assert.match(route, /configureAuthLoginResponse\(Astro\.response,\s*runtimeEnv\)/);
assert.match(route, /authTurnstileSiteKey=\{runtimeEnv\.PUBLIC_AUTH_TURNSTILE_SITE_KEY\}/);
assert.match(route, /captchaMode=\{captchaMode\}/);
const responseHelper = await readFile(resolve(root, "src/lib/server/auth-login-response.ts"), "utf8");
assert.match(responseHelper, /parseAuthCaptchaMode\(runtimeEnv\.AUTH_CAPTCHA_MODE\)/);
assert.match(responseHelper, /response\.headers\.set\(["']Cache-Control["'],\s*["']no-store["']\)/);
assert.doesNotMatch(route, /PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_SECRET/);
console.log("login SSR runtime props and no-store: PASS");

function assertPreviewContract(vars) {
  assert.equal(parseAuthCaptchaMode(vars.AUTH_CAPTCHA_MODE), "off", "preview must remain off");
  assert.equal(vars.AUTH_CAPTCHA_MODE, "off", "preview mode must be explicitly off");
  assert.equal(vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, undefined, "preview must not configure an Auth site key");
}

function assertProductionStateShape(vars) {
  const mode = parseAuthCaptchaMode(vars.AUTH_CAPTCHA_MODE);
  assert.equal(vars.AUTH_CAPTCHA_MODE, mode, "production mode must be explicit");
  if (mode === "off") {
    assert.equal(vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, undefined, "off must not configure an Auth site key");
    return;
  }
  const authSiteKey = vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
  assert.equal(typeof authSiteKey, "string", `${mode} requires a public Auth site key`);
  assert.ok(authSiteKey.trim().length > 0, `${mode} requires a non-empty public Auth site key`);
  const uploadSiteKey = typeof vars.PUBLIC_TURNSTILE_SITE_KEY === "string" ? vars.PUBLIC_TURNSTILE_SITE_KEY.trim() : undefined;
  assert.notEqual(authSiteKey.trim(), uploadSiteKey, "Auth must not reuse the upload site key");
}

const offFixture = { AUTH_CAPTCHA_MODE: "off" };
const prepareFixture = {
  AUTH_CAPTCHA_MODE: "prepare",
  PUBLIC_AUTH_TURNSTILE_SITE_KEY: "fixture-auth-public-key",
  PUBLIC_TURNSTILE_SITE_KEY: "fixture-upload-public-key",
};

const requiredFixture = { ...prepareFixture, AUTH_CAPTCHA_MODE: "required" };

function assertStateDProductionTarget(vars) {
  assertProductionStateShape(vars);
  assert.equal(vars.AUTH_CAPTCHA_MODE, "required", "checked-in State-D production must be required");
}

assert.doesNotThrow(
  () => assertStateDProductionTarget(requiredFixture),
  "STATE_D_PRODUCTION_REQUIRED_ACCEPTED: next release target must accept required with a dedicated Auth site key",
);
console.log("STATE_D_PRODUCTION_REQUIRED_ACCEPTED: PASS");

assert.doesNotThrow(() => assertPreviewContract(offFixture));
for (const fixture of [prepareFixture, { ...offFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: prepareFixture.PUBLIC_AUTH_TURNSTILE_SITE_KEY }, { AUTH_CAPTCHA_MODE: "required" }]) {
  assert.throws(() => assertPreviewContract(fixture), { code: "ERR_ASSERTION" });
}
console.log("PREVIEW_OFF_NO_AUTH_SITEKEY: PASS");

assert.doesNotThrow(() => assertProductionStateShape(offFixture));
assert.throws(() => assertProductionStateShape({ ...offFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: prepareFixture.PUBLIC_AUTH_TURNSTILE_SITE_KEY }), { code: "ERR_ASSERTION" });
console.log("GENERIC_OFF_STATE_VALID: PASS");

assert.throws(() => assertStateDProductionTarget(offFixture), { code: "ERR_ASSERTION" }, "State-D Production target must reject off");
console.log("STATE_D_PRODUCTION_OFF_REJECTED: PASS");

assert.doesNotThrow(() => assertProductionStateShape(prepareFixture));
console.log("GENERIC_PREPARE_STATE_VALID: PASS");
assert.doesNotThrow(() => assertProductionStateShape(requiredFixture));
console.log("GENERIC_REQUIRED_STATE_VALID: PASS");
assert.throws(() => assertStateDProductionTarget(prepareFixture), { code: "ERR_ASSERTION" }, "State-D Production target must reject prepare");
console.log("STATE_D_PRODUCTION_PREPARE_REJECTED: PASS");

for (const fixture of [prepareFixture, requiredFixture]) {
  for (const key of [undefined, null, "", "   ", 1]) {
    assert.throws(() => assertProductionStateShape({ ...fixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
  }
}
for (const key of [undefined, null, "", "   ", 1]) {
  assert.throws(() => assertStateDProductionTarget({ ...requiredFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
}
console.log("STATE_D_DEDICATED_AUTH_SITEKEY_REQUIRED: PASS");

for (const key of [prepareFixture.PUBLIC_TURNSTILE_SITE_KEY, ` ${prepareFixture.PUBLIC_TURNSTILE_SITE_KEY} `]) {
  for (const fixture of [prepareFixture, requiredFixture]) {
    assert.throws(() => assertProductionStateShape({ ...fixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
  }
  assert.throws(() => assertStateDProductionTarget({ ...requiredFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
}
console.log("STATE_D_UPLOAD_SITEKEY_REUSE_REJECTED: PASS");

for (const mode of ["", "OFF", "prepare ", "required ", "disabled", null, 1]) {
  for (const contract of [assertPreviewContract, assertProductionStateShape, assertStateDProductionTarget]) {
    assert.throws(() => contract({ ...prepareFixture, AUTH_CAPTCHA_MODE: mode }), (error) => error.message === "AUTH_CAPTCHA_MODE_INVALID");
  }
}
console.log("INVALID_MODE_FAIL_CLOSED: PASS");

for (const environment of ["preview", "production"]) {
  const config = unstable_readConfig(
    { config: resolve(root, "wrangler.toml"), env: environment },
    { hideWarnings: true },
  );
  if (environment === "preview") assertPreviewContract(config.vars);
  else assertStateDProductionTarget(config.vars);
}
console.log("preview and production State-D release contracts: PASS");
