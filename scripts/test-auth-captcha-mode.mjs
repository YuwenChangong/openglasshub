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

function assertProductionContract(vars) {
  const mode = parseAuthCaptchaMode(vars.AUTH_CAPTCHA_MODE);
  assert.equal(vars.AUTH_CAPTCHA_MODE, mode, "production mode must be explicit");
  assert.ok(mode === "off" || mode === "prepare", "required is not authorized by the State-B release contract");
  if (mode === "off") {
    assert.equal(vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, undefined, "off must not configure an Auth site key");
    return;
  }
  const authSiteKey = vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
  assert.equal(typeof authSiteKey, "string", "prepare requires a public Auth site key");
  assert.ok(authSiteKey.trim().length > 0, "prepare requires a non-empty public Auth site key");
  const uploadSiteKey = typeof vars.PUBLIC_TURNSTILE_SITE_KEY === "string" ? vars.PUBLIC_TURNSTILE_SITE_KEY.trim() : undefined;
  assert.notEqual(authSiteKey.trim(), uploadSiteKey, "Auth must not reuse the upload site key");
}

const offFixture = { AUTH_CAPTCHA_MODE: "off" };
const prepareFixture = {
  AUTH_CAPTCHA_MODE: "prepare",
  PUBLIC_AUTH_TURNSTILE_SITE_KEY: "fixture-auth-public-key",
  PUBLIC_TURNSTILE_SITE_KEY: "fixture-upload-public-key",
};

assert.doesNotThrow(() => assertPreviewContract(offFixture));
for (const fixture of [prepareFixture, { ...offFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: prepareFixture.PUBLIC_AUTH_TURNSTILE_SITE_KEY }, { AUTH_CAPTCHA_MODE: "required" }]) {
  assert.throws(() => assertPreviewContract(fixture), { code: "ERR_ASSERTION" });
}
console.log("PREVIEW_OFF_NO_AUTH_SITEKEY: PASS");

assert.doesNotThrow(() => assertProductionContract(offFixture));
assert.throws(() => assertProductionContract({ ...offFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: prepareFixture.PUBLIC_AUTH_TURNSTILE_SITE_KEY }), { code: "ERR_ASSERTION" });
console.log("PRODUCTION_OFF_NO_AUTH_SITEKEY_ALLOWED: PASS");

assert.doesNotThrow(() => assertProductionContract(prepareFixture));
for (const key of [undefined, null, "", "   ", 1]) {
  assert.throws(() => assertProductionContract({ ...prepareFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
}
console.log("PRODUCTION_PREPARE_DEDICATED_AUTH_SITEKEY_REQUIRED: PASS");

for (const key of [prepareFixture.PUBLIC_TURNSTILE_SITE_KEY, ` ${prepareFixture.PUBLIC_TURNSTILE_SITE_KEY} `]) {
  assert.throws(() => assertProductionContract({ ...prepareFixture, PUBLIC_AUTH_TURNSTILE_SITE_KEY: key }), { code: "ERR_ASSERTION" });
}
console.log("PRODUCTION_PREPARE_AUTH_KEY_MUST_DIFFER_FROM_UPLOAD_KEY: PASS");

for (const fixture of [{ AUTH_CAPTCHA_MODE: "required" }, { ...prepareFixture, AUTH_CAPTCHA_MODE: "required" }]) {
  assert.throws(() => assertProductionContract(fixture), { code: "ERR_ASSERTION" });
}
console.log("PRODUCTION_REQUIRED_NOT_YET_AUTHORIZED: PASS");

for (const mode of ["", "OFF", "prepare ", "required ", "disabled", null, 1]) {
  for (const contract of [assertPreviewContract, assertProductionContract]) {
    assert.throws(() => contract({ ...prepareFixture, AUTH_CAPTCHA_MODE: mode }), (error) => error.message === "AUTH_CAPTCHA_MODE_INVALID");
  }
}
console.log("ROLLOUT_INVALID_MODE_FAIL_CLOSED: PASS");

for (const environment of ["preview", "production"]) {
  const config = unstable_readConfig(
    { config: resolve(root, "wrangler.toml"), env: environment },
    { hideWarnings: true },
  );
  if (environment === "preview") assertPreviewContract(config.vars);
  else assertProductionContract(config.vars);
}
console.log("preview and production State-B release contracts: PASS");
