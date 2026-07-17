import assert from "node:assert/strict";
import { classifyLegalConsentRoute, isLegalConsentRedirectTarget } from "../src/lib/legal-consent-route-policy.ts";

const cases = {
  "/": "exempt", "/legal-consent/": "exempt", "/login/": "exempt", "/register/": "exempt", "/auth/callback/": "exempt", "/products/": "exempt", "/api/forum/posts": "exempt",
  "/feed/": "public-signed-out-consent-if-authenticated", "/posts/42": "public-signed-out-consent-if-authenticated", "/circles/": "public-signed-out-consent-if-authenticated", "/circles/x/": "public-signed-out-consent-if-authenticated",
  "/notifications/": "authenticated-and-consented", "/posts/new/": "authenticated-and-consented", "/me/": "authenticated-and-consented", "/circles/new/": "authenticated-and-consented", "/circles/x/manage/": "authenticated-and-consented", "/admin/forum/": "authenticated-and-consented", "/unclassified/private/": "authenticated-and-consented",
};
for (const [route, expected] of Object.entries(cases)) assert.equal(classifyLegalConsentRoute(route), expected, route);
assert.equal(isLegalConsentRedirectTarget("/legal-consent/"), false);
assert.equal(isLegalConsentRedirectTarget("/notifications/"), true);
console.log("LEGAL_CONSENT_PAGE_GATE_OK routes=" + Object.keys(cases).length);
