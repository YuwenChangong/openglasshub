import assert from "node:assert/strict";
import { build, dev } from "astro";
import cloudflare from "@astrojs/cloudflare";
import { createServer } from "vite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
import localeSsrRoutes from "../src/plugins/locale-ssr-routes.mjs";

const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    external++;
    const category = url.hostname.endsWith(".supabase.co") ? "SUPABASE" : url.hostname.endsWith("cloudflare.com") ? "CLOUDFLARE" : "OTHER_EXTERNAL";
    const frame = new Error().stack?.split("\n").slice(2).find(line => /(?:src|node_modules)[\\/]/.test(line));
    console.error(`EXTERNAL_FETCH_BLOCKED_CATEGORY=${category}`);
    if (frame) console.error(`EXTERNAL_FETCH_LOCAL_CALLER=${frame.trim().replace(/\?.*?(?=:\d+:\d+\))/, "")}`);
    throw new Error("EXTERNAL_HTTP_FORBIDDEN");
  }
  return originalFetch(input, init);
};
let server;
let vite;
let buildRoot;
let publicHookObserved = false;
const previousCfFetch = process.env.CLOUDFLARE_CF_FETCH_ENABLED;
const previousTelemetry = process.env.ASTRO_TELEMETRY_DISABLED;
const previousUpdateCheck = process.env.ASTRO_DISABLE_UPDATE_CHECK;
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.ASTRO_TELEMETRY_DISABLED = "1";
process.env.ASTRO_DISABLE_UPDATE_CHECK = "true";
try {
  server = await dev({ root: new URL("../", import.meta.url), server: { host: "127.0.0.1", port: 0 }, logLevel: "error", devToolbar: { enabled: false },
    adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }), integrations: [{
    name: "locale-public-hook-fixture",
    hooks: { "astro:route:setup": ({ route }) => {
      assert.equal(typeof route.component, "string");
      assert.ok(route.prerender === undefined || typeof route.prerender === "boolean");
      if (route.component.replaceAll("\\", "/").endsWith("src/pages/login/index.astro")) {
        assert.notEqual(Object.getOwnPropertyDescriptor(route, "prerender")?.writable, false);
        publicHookObserved = true;
      }
    } },
  }] });
  const origin = `http://127.0.0.1:${server.address.port}`;
  const cookie = serializePreferenceCookie({ version: 1, preference: "en", generation: 1, provenance: "device_explicit" }).split(";")[0];
  const english = await fetch(`${origin}/login/`, { headers: { cookie, "accept-language": "zh-CN" } });
  assert.equal(english.status, 200);
  assert.equal(publicHookObserved, true, "Installed Astro must call the public component/prerender hook");
  console.log("ASTRO_PUBLIC_ROUTE_HOOK_COMPATIBILITY=PASS");
  assert.ok(/<html[^>]*lang="en"/.test(await english.text()), "Actual SSR must honor the cookie instead of fixed Chinese markup");
  assert.match(english.headers.get("cache-control"), /private/);
  assert.match(english.headers.get("cache-control"), /no-store/);
  for (const locale of ["zh-CN", "en"]) {
    const selected = serializePreferenceCookie({ version: 1, preference: locale, generation: 2, provenance: "device_explicit" }).split(";")[0];
    const response = await fetch(`${origin}/login/`, { headers: { cookie: `unrelated=ignored; ${selected}` } });
    const html = await response.text();
    assert.ok(new RegExp(`<html[^>]*lang="${locale}"`).test(html));
    assert.ok(new RegExp(`property="og:locale" content="${locale === "en" ? "en_US" : "zh_CN"}"`).test(html));
  }
  await server.stop(); server = undefined;
  vite = await createServer({ root: process.cwd(), configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
  const { onRequest } = await vite.ssrLoadModule("/src/middleware.ts");
  async function apply({ pathname = "/login/", country, preference, language = "en", invalidCookie, cache = "no-store, no-cache", contentType = "text/plain" } = {}) {
    const request = new Request(`http://127.0.0.1${pathname}`, { headers: { "accept-language": language } });
    if (country) Object.defineProperty(request, "cf", { value: { country } });
    const locals = {};
    const value = invalidCookie ? "malformed" : preference ? serializePreferenceCookie({ version: 1, preference, generation: 1, provenance: "device_explicit" }).split("=").slice(1).join("=").split(";")[0] : undefined;
    const response = new Response("fixture", { headers: { "cache-control": cache, "content-type": contentType } });
    const result = await onRequest({ request, locals, url: new URL(request.url), cookies: { get: () => value ? { value } : undefined } }, async () => {
      assert.ok(locals.localeContext, "request locals must be resolved before next");
      return response;
    });
    assert.doesNotMatch(JSON.stringify(locals), /"country"\s*:|"CN"|"US"/);
    return { locals, result, response };
  }
  const [cn, us] = await Promise.all([apply({ country: "CN" }), apply({ country: "US", language: "zh-CN" })]);
  assert.equal(cn.locals.localeContext.locale, "zh-CN"); assert.equal(us.locals.localeContext.locale, "en");
  assert.notEqual(cn.locals.localeContext, us.locals.localeContext);
  assert.equal((await apply({ country: "CN", preference: "en" })).locals.localeContext.locale, "en");
  assert.equal((await apply({ country: "US", preference: "zh-CN" })).locals.localeContext.locale, "zh-CN");
  assert.equal((await apply({ invalidCookie: true, country: "US", language: "zh-CN" })).locals.localeContext.locale, "en");
  assert.equal((await apply({ language: "zh-CN" })).locals.localeContext.locale, "zh-CN");
  assert.match(cn.result.headers.get("cache-control"), /no-cache/);
  for (const pathname of ["/api/users/me/preferences", "/_astro/app.js", "/sitemap-index.xml", "/robots.txt", "/brand/logo.png"]) {
    const { result, response } = await apply({ pathname, cache: "public, max-age=31536000, immutable" });
    assert.equal(result, response, "API and asset responses remain unchanged");
  }
  const missingAsset = await apply({ pathname: "/missing.css", contentType: "text/html", cache: "public, max-age=3600" });
  assert.match(missingAsset.result.headers.get("cache-control"), /private/);
  assert.match(missingAsset.result.headers.get("cache-control"), /no-store/);
  await vite.close(); vite = undefined;
  const setup = localeSsrRoutes().hooks["astro:route:setup"];
  for (const component of ["src/pages/index.astro", "src/pages/404.astro", "src/pages/guides/[slug].astro"]) {
    const route = { component, prerender: true }; setup({ route }); assert.equal(route.prerender, false);
  }
  const endpoint = { component: "src/pages/api/example.ts", prerender: true }; setup({ route: endpoint }); assert.equal(endpoint.prerender, true);
  const buildCache = path.join(process.cwd(), "node_modules/.cache");
  await mkdir(buildCache, { recursive: true });
  buildRoot = await mkdtemp(path.join(buildCache, "openglass-locale-manifest-"));
  let manifest;
  await build({ root: new URL("../", import.meta.url), outDir: buildRoot, logLevel: "error",
    adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }),
    integrations: [{ name: "locale-built-manifest-fixture", hooks: { "astro:build:ssr": value => { manifest = value.manifest; } } }],
  });
  assert.ok(manifest, "real build must produce an SSR manifest");
  const pages = manifest.routes.filter(({ routeData }) => /(?:^|\/)src\/pages\//.test(routeData.component.replaceAll("\\", "/")) && /\.(?:astro|md|mdx)$/.test(routeData.component));
  assert.ok(pages.length > 10, "manifest must cover application HTML pages");
  assert.ok(pages.every(({ routeData }) => routeData.prerender === false), "all application HTML must be on demand");
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 0, "static assets remain in the serialized manifest");
  assert.equal(external, 0);
  console.log("LOCALE_MIDDLEWARE_SSR=PASS");
} finally {
  await server?.stop();
  await vite?.close();
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  if (previousCfFetch === undefined) delete process.env.CLOUDFLARE_CF_FETCH_ENABLED;
  else process.env.CLOUDFLARE_CF_FETCH_ENABLED = previousCfFetch;
  if (previousTelemetry === undefined) delete process.env.ASTRO_TELEMETRY_DISABLED;
  else process.env.ASTRO_TELEMETRY_DISABLED = previousTelemetry;
  if (previousUpdateCheck === undefined) delete process.env.ASTRO_DISABLE_UPDATE_CHECK;
  else process.env.ASTRO_DISABLE_UPDATE_CHECK = previousUpdateCheck;
}
