import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
async function read(file) { return readFile(path.join(root, file), "utf8"); }

async function main() {
  const helper = await read("src/lib/legal-consent-client.ts");
  const authPanel = await read("src/components/forum/AuthPanel.tsx");
  const callback = await read("src/components/auth/AuthCallback.tsx");
  const consentPage = await read("src/components/legal/LegalConsentPage.tsx");
  const consentRoute = await read("src/pages/legal-consent/index.astro");

  assert(helper.includes('fetch("/api/legal/consent"'));
  assert(helper.includes('authorization: `Bearer ${accessToken}`'));
  assert(helper.includes('JSON.stringify({ accepted: true, source: params.source })'));
  assert(!/userId|bundleVersion|minimumAge|acceptedAt/.test(helper.match(/recordLegalConsent[\s\S]*/)?.[0] ?? ""));
  assert(!/localStorage|document\.cookie|SUPABASE_SERVICE_ROLE_KEY/.test(helper));

  assert(authPanel.indexOf("signInWithPassword") < authPanel.indexOf('recordLegalConsent({ accessToken, source: "login" })'));
  assert(authPanel.indexOf('recordLegalConsent({ accessToken, source: "login" })') < authPanel.indexOf("window.location.assign(safeNext)"));
  assert(authPanel.includes('recordLegalConsent({ accessToken, source: "registration" })'));
  assert(authPanel.includes("const accessToken = signUpData.session?.access_token"));
  assert(authPanel.includes("if (accessToken)"));
  assert(authPanel.includes("验证邮件已发送"));
  assert(authPanel.includes("consentRecoveryHref(safeNext)"));
  assert(!authPanel.includes('from("legal_policy_acceptances")'));

  assert(callback.includes("getLegalConsentStatus"));
  assert(callback.includes("consent.current ? safeNext"));
  assert(callback.includes("/legal-consent/?next="));
  assert(!callback.includes("recordLegalConsent"));

  assert(consentRoute.includes("LegalConsentPage"));
  assert(consentPage.includes('type="checkbox"'));
  assert(consentPage.includes('htmlFor="legal-consent-acknowledgement"'));
  assert(consentPage.includes('role="alert"'));
  assert(consentPage.includes("记录政策确认"));
  assert(consentPage.includes("重试"));
  assert(consentPage.includes("退出登录"));
  assert(consentPage.includes("getSafeNext"));
  assert(!/row id|历史记录|历史同意/.test(consentPage));

  console.log("LEGAL_CONSENT_AUTH_FLOW_OK offline static auth/callback/page checks passed");
}

main().catch((error) => { console.error("LEGAL_CONSENT_AUTH_FLOW_FAIL", error.message); process.exitCode = 1; });
