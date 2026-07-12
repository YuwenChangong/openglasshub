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

  assert(legalPolicy.includes("minimumAge: 16"), "The central legal configuration must retain the 16+ rule.");
  assert(authPanel.includes('import { LEGAL_POLICY } from "../../lib/legal-policy";'), "Auth UI must import central legal policy configuration.");
  assert(!/const\s+(?:MINIMUM_AGE|LEGAL_MINIMUM_AGE)\s*=\s*16/.test(authPanel), "Auth UI must not define a conflicting minimum-age constant.");
  assert(authPanel.includes("const [legalAcknowledged, setLegalAcknowledged] = useState(false);"), "Legal acknowledgement must be unchecked by default.");
  assert(!/localStorage\.(?:getItem|setItem)\([^)]*legal/i.test(authPanel), "Legal acknowledgement must not use localStorage.");
  assert(!/document\.cookie|cookies?/i.test(authPanel), "Legal acknowledgement must not use cookies.");

  assert((authPanel.match(/type="checkbox"/g) ?? []).length === 1, "Auth UI must render exactly one legal checkbox.");
  assert(authPanel.includes('id="auth-legal-acknowledgement"'), "The legal checkbox needs a stable associated ID.");
  assert(authPanel.includes('htmlFor="auth-legal-acknowledgement"'), "The legal checkbox needs an associated label.");
  assert(authPanel.includes("LEGAL_POLICY.routes.terms"), "Terms link must use the central route.");
  assert(authPanel.includes("LEGAL_POLICY.routes.guidelines"), "Guidelines link must use the central route.");
  assert(authPanel.includes("LEGAL_POLICY.routes.privacy"), "Privacy link must use the central route.");
  assert((authPanel.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length === 6, "Each bilingual policy link must open safely in a new tab.");
  assert((authPanel.match(/event\.stopPropagation\(\)/g) ?? []).length === 6, "Policy links must not toggle acknowledgement or submit auth.");
  assert(authPanel.includes("我确认已年满 {LEGAL_POLICY.minimumAge} 周岁"), "Chinese acknowledgement must use the central age.");
  assert(authPanel.includes("I confirm that I am at least {LEGAL_POLICY.minimumAge} years old"), "English acknowledgement must use the central age.");
  assert(!/marketing|analytics/i.test(authPanel), "No optional marketing or analytics consent may be bundled into auth.");
  assert(!/consent.*(?:persist|record)|(?:persist|record).*consent/i.test(authPanel), "Phase 2 auth UI must not claim server consent persistence.");

  assert(authPanel.indexOf("if (!legalAcknowledged)") < authPanel.indexOf("setLoading(true)"), "Unchecked auth submit must be blocked before loading or provider calls.");
  assert(authPanel.includes("setLegalAcknowledgementError(LEGAL_ACKNOWLEDGEMENT_ERROR);"), "Unchecked auth submit must show a local acknowledgement error.");
  assert(authPanel.includes("const { error: signInError } = await supabase.auth.signInWithPassword"), "Checked login must retain the existing sign-in call.");
  assert(authPanel.includes("const { error: signUpError } = await supabase.auth.signUp"), "Checked signup must retain the existing signup call.");
  assert(authPanel.includes('aria-describedby={legalAcknowledgementError ? "auth-legal-acknowledgement-error" : undefined}'), "Acknowledgement errors must be associated with the control.");
  assert(authPanel.includes('role="alert"'), "Acknowledgement error must be exposed accessibly.");
  assert(authPanel.includes("if (checked) setLegalAcknowledgementError(\"\");"), "Checking the control must clear the local acknowledgement error.");
  assert((authPanel.match(/setLegalAcknowledged\(false\);/g) ?? []).length >= 4, "Mode and password-recovery transitions must require a fresh acknowledgement.");
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
