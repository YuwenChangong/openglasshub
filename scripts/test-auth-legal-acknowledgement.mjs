import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { cloudflareWorkersTestPlugin } from "./lib/cloudflare-workers-test-plugin.mjs";
import { getAuthMessages } from "../src/lib/auth-messages.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { LEGAL_POLICY_LINKS } from "../src/lib/legal-policy.ts";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function main() {
  const authPanel = await read("src/components/forum/AuthPanel.tsx");
  const legalPolicy = await read("src/lib/legal-policy.ts");
  const loginPage = await read("src/pages/login/index.astro");
  const registerPage = await read("src/pages/register/index.astro");
  const docs = await read("docs/ops/legal-trust-policy-management.md");
  const layoutSource = await read("src/layouts/CommunityLayout.astro");
  const messages = await read("src/lib/auth-messages.ts").catch(() => "");

  assert(legalPolicy.includes("minimumAge: 16"), "The central legal configuration must retain the 16+ rule.");
  assert(legalPolicy.includes('bundleVersion: "2026-07"'), "The accepted policy bundle must remain 2026-07.");
  function neutralFooter() {
    assert(!/siteName\s*}\s*·\s*{LEGAL_POLICY\.minimumAge/.test(layoutSource), "Ordinary footer must not present a 16+ brand badge.");
    const footer = layoutSource.slice(layoutSource.indexOf("<footer"), layoutSource.indexOf("</footer>"));
    const expression = footer.match(/<span>\s*\{([^{}]+)\}\s*<\/span>/)?.[1];
    assert(expression, "Footer must select a single legal label.");
    const ast = ts.createSourceFile("footer.ts", `const label = ${expression};`, ts.ScriptTarget.Latest, true);
    const label = ast.statements[0]?.declarationList?.declarations[0]?.initializer;
    assert(label && ts.isConditionalExpression(label), "Footer labels must follow request locale.");
    assert(label.condition.getText(ast) === 'localeContext.locale === "en"', "Footer condition must use request locale.");
    assert(label.whenTrue.getText(ast) === "link.labelEn" && label.whenFalse.getText(ast) === "link.labelZh", "Each shell must render only its selected-language legal labels.");
    assert(layoutSource.includes("Astro.locals.localeContext") && layoutSource.includes("getUiMessages(localeContext.locale)"), "Footer must consume request-wide locale.");
    assert(LEGAL_POLICY_LINKS.every(link => link.labelZh && link.labelEn), "Canonical legal labels must exist in both languages.");
  }
  neutralFooter();
  assert(messages.includes('export type AuthLocale = "zh-CN" | "en"'), "Auth messages must have a typed locale.");
  assert(authPanel.includes('import { LEGAL_POLICY } from "../../lib/legal-policy";'), "Auth UI must import central legal policy configuration.");
  assert(!/const\s+(?:MINIMUM_AGE|LEGAL_MINIMUM_AGE)\s*=\s*16/.test(authPanel), "Auth UI must not define a conflicting minimum-age constant.");
  assert(!authPanel.includes("legalAcknowledged"), "Auth submit must not depend on legal acknowledgement.");
  assert(!/localStorage\.(?:getItem|setItem)\([^)]*legal/i.test(authPanel), "Legal acknowledgement must not use localStorage.");
  assert(!/document\.cookie|cookies?/i.test(authPanel), "Legal acknowledgement must not use cookies.");

  assert(!authPanel.includes('type="checkbox"'), "Auth UI must not render age/legal controls.");
  assert(authPanel.includes('mode === "signup" ? ('), "Legal notice must appear only in signup mode.");
  assert(authPanel.includes('className="auth-signup-notice"'), "Signup must have a compact non-blocking notice.");
  assert(authPanel.includes("LEGAL_POLICY.routes.terms"), "Terms link must use the central route.");
  assert(authPanel.includes("LEGAL_POLICY.routes.guidelines"), "Guidelines link must use the central route.");
  assert(authPanel.includes("LEGAL_POLICY.routes.privacy"), "Privacy link must use the central route.");
  assert((authPanel.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length === 3, "Selected-language policy links must open safely in a new tab.");
  assert(!/marketing|analytics/i.test(authPanel), "No optional marketing or analytics consent may be bundled into auth.");
  assert(!authPanel.includes("recordLegalConsent"), "Login and signup must not record consent.");

  assert(authPanel.includes("supabase!.auth.signInWithPassword"), "Login must retain password authentication.");
  assert(authPanel.includes("supabase!.auth.signUp"), "Signup must retain provider registration.");
  assert(!authPanel.includes("ageEligible"), "Age must not gate auth submission.");
  assert(loginPage.includes('initialMode={initialMode}'), "Login route must preserve mode selection.");
  assert(registerPage.includes('"/login/?mode=register"'), "Register route must continue to open signup mode.");
  assert(docs.includes("frontend/auth-entry enforcement only"), "Operations documentation must describe Phase 2 limits.");
  assert(docs.includes("localStorage proof, or cookie proof"), "Operations documentation must reject browser persistence as consent proof.");

  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  let vite;
  globalThis.fetch = async () => { externalRequests++; throw new Error("EXTERNAL_FORBIDDEN"); };
  try {
    vite = await createServer({ root, configFile: false, logLevel: "error", plugins: [cloudflareWorkersTestPlugin()],
      esbuild: { jsx: "automatic" }, ssr: { external: ["react", "react-dom", "react/jsx-runtime"] },
      server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true } });
    const AuthPanel = (await vite.ssrLoadModule("/src/components/forum/AuthPanel.tsx")).default;
    for (const locale of ["zh-CN", "en"]) {
      const text = getAuthMessages(locale);
      for (const initialMode of ["login", "signup"]) {
        const dom = new JSDOM(renderToStaticMarkup(createElement(AuthPanel, {
          localeContext: resolveLocale({ current: locale }), initialMode, captchaMode: "off", next: "/feed/",
          authAdapter: { viewState: "signed_out", userPresent: false },
        })));
        try {
          const document = dom.window.document;
          const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')].map(button => button.textContent);
          assert(tabs.length === 2 && tabs.includes(text.login) && tabs.includes(text.signup), "Actual Auth tabs must use the selected locale.");
          const links = [...document.querySelectorAll(".auth-signup-notice a")];
          assert(links.length === (initialMode === "signup" ? 3 : 0), "Compact notice must be signup-only.");
          if (initialMode === "signup") {
            const expected = [text.signupNoticeTerms, text.signupNoticePrivacy, text.signupNoticeGuidelines];
            assert(links.every((link, index) => link.textContent === expected[index]), "Actual signup legal labels must use the selected locale.");
            assert(links.every(link => link.target === "_blank" && link.rel === "noopener noreferrer"), "Rendered policy links must open safely.");
          }
          assert(!document.querySelector('input[type="checkbox"]'), "Rendered Auth must not introduce legal/age blockers.");
        } finally { dom.window.close(); }
      }
    }
    assert(externalRequests === 0, "Auth render contract must not make external requests.");
  } finally { await vite?.close(); globalThis.fetch = originalFetch; }
  console.log("AUTH_LEGAL_ACKNOWLEDGEMENT_OK SSR_BOTH_LOCALES=PASS FOOTER_LOCALE_AST=PASS EXTERNAL_REQUESTS=0");
}

main().catch((error) => {
  console.error(`AUTH_LEGAL_ACKNOWLEDGEMENT_FAIL ${error.message}`);
  process.exitCode = 1;
});
