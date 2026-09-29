import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
    assert(layoutSource.includes("{link.labelZh}"), "Chinese shell must use Chinese legal labels.");
    assert(!layoutSource.includes("{link.labelEn}"), "Chinese shell must not duplicate English legal labels.");
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

  console.log("AUTH_LEGAL_ACKNOWLEDGEMENT_OK files=5");
}

main().catch((error) => {
  console.error(`AUTH_LEGAL_ACKNOWLEDGEMENT_FAIL ${error.message}`);
  process.exitCode = 1;
});
