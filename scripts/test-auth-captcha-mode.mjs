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
assert.match(route, /parseAuthCaptchaMode\(runtimeEnv\.AUTH_CAPTCHA_MODE\)/);
assert.match(route, /authTurnstileSiteKey=\{runtimeEnv\.PUBLIC_AUTH_TURNSTILE_SITE_KEY\}/);
assert.match(route, /captchaMode=\{captchaMode\}/);
assert.match(route, /Astro\.response\.headers\.set\(["']Cache-Control["'],\s*["']no-store["']\)/);
assert.doesNotMatch(route, /PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_SECRET/);
console.log("login SSR runtime props and no-store: PASS");

for (const environment of ["preview", "production"]) {
  const config = unstable_readConfig(
    { config: resolve(root, "wrangler.toml"), env: environment },
    { hideWarnings: true },
  );
  const vars = config.vars;
  assert.equal(vars.AUTH_CAPTCHA_MODE, "off", `${environment} starts with auth CAPTCHA off`);
  assert.equal(vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY, undefined, `${environment} has no invented auth site key`);
  assert.equal(parseAuthCaptchaMode(vars.AUTH_CAPTCHA_MODE), "off");
}
console.log("preview and production safe defaults: PASS");
