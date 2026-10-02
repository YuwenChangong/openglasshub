import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { dev } from "astro";
import cloudflare from "@astrojs/cloudflare";
import { getUiMessages, formatUiMessage } from "../src/lib/i18n/catalog.ts";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
import { LEGAL_POLICY } from "../src/lib/legal-policy.ts";

const legalPage = await readFile("src/components/legal/LegalPage.astro", "utf8");
assert.match(legalPage, /resolveDocumentLocale\(Astro\.url\.searchParams\.get\("lang"\), uiLocale\)/, "LegalPage must select a document locale without changing the shell locale");
const { resolveDocumentLocale } = await import("../src/lib/i18n/document-locale.ts");
for (const uiLocale of ["zh-CN", "en"]) {
  for (const value of [null, "", "auto", "EN", "zh", "en ", "../en", "\0en"]) assert.equal(resolveDocumentLocale(value, uiLocale), uiLocale);
  for (const value of ["zh-CN", "en"]) assert.equal(resolveDocumentLocale(value, uiLocale), value);
}
const routes = ["terms", "privacy", "community-guidelines", "safety", "account-deletion", "contact"];
const base = "318a252d8b8e6489044b322c3e9eefd72e9d6e08";
function authoredBodies(source) {
  const ast = ts.createSourceFile("legal.ts", source.split("---")[1], ts.ScriptTarget.Latest, true);
  return ast.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => ts.isIdentifier(declaration.name) && ["zh", "en"].includes(declaration.name.text))
    .map((declaration) => [declaration.name.text, declaration.initializer.getText(ast).replace(/\r\n?/g, "\n")]);
}
for (const route of routes) {
  const file = `src/pages/${route}/index.astro`;
  assert.deepEqual(authoredBodies(await readFile(file, "utf8")), authoredBodies(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" })), `${route} reviewed bodies must remain exact`);
}
for (const file of ["src/lib/legal-policy.ts", "src/lib/public-legal-contacts.ts", "src/pages/legal-consent/index.astro"]) {
  assert.equal((await readFile(file, "utf8")).replace(/\r\n?/g, "\n"), execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }).replace(/\r\n?/g, "\n"), `${file} unchanged`);
}
assert.doesNotMatch(legalPage, /cookies\.set|document\.cookie|savePreference|generation\s*=|user_preferences|\.from\(|\.rpc\(/);

const originalFetch = globalThis.fetch;
let external = 0, server;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { external++; throw new Error("EXTERNAL_FORBIDDEN"); }
  return originalFetch(input, init);
};
try {
  server = await dev({ root: new URL("../", import.meta.url), logLevel: "error", devToolbar: { enabled: false },
    server: { host: "127.0.0.1", port: 0 }, adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }),
    vite: { plugins: [{ name: "owned-legal-no-auth", enforce: "pre", resolveId(id) {
      if (/(?:^|\/)supabase-browser(?:\.ts)?$/.test(id)) return "\0owned-legal-no-auth";
    }, load(id) { if (id === "\0owned-legal-no-auth") return "export const createBrowserSupabaseClient=()=>null; export const syncBrowserRealtimeAuth=async()=>null;"; } }] } });
  const origin = `http://127.0.0.1:${server.address.port}`;
  for (const uiLocale of ["zh-CN", "en"]) {
    const cookie = serializePreferenceCookie({ version: 1, preference: uiLocale, generation: 37, provenance: "device_explicit" }).split(";")[0];
    const text = getUiMessages(uiLocale).documents;
    for (const route of routes) {
      for (const query of ["", "?lang=zh-CN", "?lang=en", "?lang=en%20", "?lang=%3Cscript%3E"]) {
        const selected = resolveDocumentLocale(new URL(origin + "/" + route + "/" + query).searchParams.get("lang"), uiLocale);
        const response = await fetch(`${origin}/${route}/${query}`, { headers: { cookie } });
        assert.equal(response.status, 200, `${route} legal request succeeds`);
        assert.equal(response.headers.get("set-cookie"), null, "Document navigation must not write preferences");
        assert.match(response.headers.get("cache-control"), /no-store/);
        const dom = new JSDOM(await response.text());
        const document = dom.window.document;
        assert.equal(document.documentElement.lang, uiLocale, "Shell locale remains global");
        assert.equal(document.querySelectorAll(".legal-page__section").length, 1);
        assert.equal(document.querySelector(".legal-page__section").lang, selected);
        assert.equal(document.querySelectorAll(".legal-page h1").length, 1);
        assert.equal(document.querySelector(".legal-page__language-nav").getAttribute("aria-label"), text.languageNavigation);
        const languageLinks = [...document.querySelectorAll(".legal-page__language-nav a")];
        assert.deepEqual(languageLinks.map((link) => new URL(link.getAttribute("href"), origin).searchParams.get("lang")), ["zh-CN", "en"]);
        assert.equal(languageLinks.filter((link) => link.getAttribute("aria-current") === "true").length, 1);
        assert.ok(document.querySelector(".legal-page__meta").textContent.includes(LEGAL_POLICY.effectiveDate));
        assert.ok(document.querySelector(".legal-page__meta").textContent.includes(formatUiMessage(text.version, { version: LEGAL_POLICY.bundleVersion, date: LEGAL_POLICY.effectiveDate })));
        for (const link of document.querySelectorAll(".legal-page__policy-nav a")) assert.ok(Object.values(LEGAL_POLICY.routes).includes(link.getAttribute("href")));
        assert.equal(cookie, serializePreferenceCookie({ version: 1, preference: uiLocale, generation: 37, provenance: "device_explicit" }).split(";")[0]);
        dom.window.close();
      }
    }
  }
  assert.equal(external, 0);
  console.log("LOCALE_LEGAL_DOCUMENTS=PASS REAL_LOCAL_SSR=PASS REVIEWED_BODIES_UNCHANGED=PASS GLOBAL_PREFERENCE_UNCHANGED=PASS EXTERNAL_REQUESTS=0");
} finally { await server?.stop(); globalThis.fetch = originalFetch; }
