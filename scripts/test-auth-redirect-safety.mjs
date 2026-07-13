import assert from "node:assert/strict";
import { createServer } from "vite";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../src/lib/auth-redirect.ts";

const trustedOrigin = "https://openglasshub.pages.dev";
const fallback = "/feed/";
const safeOutput = (input) => getSafeNext(input, fallback);

const validCases = [
  "/",
  "/feed/",
  "/legal-consent/",
  "/forum/post?id=123",
  "/notifications/#latest",
  "/forum/post?id=123#reply",
  "/forum/%E6%B5%8B%E8%AF%95?tag=%E7%9C%BC%E9%95%9C",
  "/login/?next=%2Ffeed%2F",
  "/login/?mode=register&next=%2Ffeed%2F",
  "/auth/reset-password/",
];

for (const input of validCases) {
  const output = safeOutput(input);
  assert.equal(new URL(output, trustedOrigin).origin, trustedOrigin, input);
  assert.equal(output.includes("\\"), false, input);
  assert.equal(/[\u0000-\u001f\u007f]/u.test(output), false, input);
}

const rejectedCases = [
  "https://evil.example/",
  "http://evil.example/",
  "https://openglasshub.pages.dev/feed/",
  "//evil.example/",
  "///evil.example/",
  "\\\\evil.example",
  "/\\\\evil.example",
  "\\evil.example",
  "/\\/evil.example",
  "/%5cevil.example",
  "/%255cevil.example",
  "/%2f%2fevil.example",
  "/%252f%252fevil.example",
  "javascript:alert(1)",
  "data:text/html,boom",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "https://user:pass@evil.example/",
  " /feed/",
  "/feed/ ",
  "\t/feed/",
  "/feed/\r",
  "/feed/\n",
  "/feed/\u0000",
  "\u3000/feed/",
  "/feed/%",
  "/feed/%0a",
];

for (const input of rejectedCases) {
  const output = safeOutput(input);
  assert.equal(output, fallback, input);
  assert.equal(new URL(output, trustedOrigin).origin, trustedOrigin, input);
  assert.equal(output.includes("\\"), false, input);
  assert.equal(/[\u0000-\u001f\u007f]/u.test(output), false, input);
}

const callbackUrl = buildAuthCallbackRedirect(trustedOrigin, "/\\\\evil.example");
assert(callbackUrl);
assert.equal(new URL(callbackUrl).origin, trustedOrigin);
const callbackNext = new URL(callbackUrl).searchParams.get("next");
assert.equal(getSafeNext(callbackNext, fallback), "/");

const browserCalls = [];
const originalWindow = globalThis.window;
globalThis.window = {
  location: {
    pathname: "/login/",
    search: "?next=%2Ffeed%2F",
    hash: "#auth",
    assign: (url) => browserCalls.push(["assign", url]),
    replace: (url) => browserCalls.push(["replace", url]),
  },
};

const vite = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const { browserNavigationAdapter } = await vite.ssrLoadModule("/src/lib/legal-consent-adapters.ts");
  const navigation = browserNavigationAdapter();
  navigation.replace(callbackNext ?? "/\\\\evil.example");
  navigation.navigate("/\\\\evil.example");
  assert.deepEqual(browserCalls, [["replace", "/"], ["assign", "/"]]);
  assert.equal(navigation.getCurrentUrl(), "/login/?next=%2Ffeed%2F#auth");
} finally {
  await vite.close();
  globalThis.window = originalWindow;
}

assert.equal(buildResetPasswordRedirect(trustedOrigin), `${trustedOrigin}/auth/reset-password/`);
assert.equal(buildResetPasswordRedirect("https://preview.openglasshub.pages.dev"), "https://preview.openglasshub.pages.dev/auth/reset-password/");
assert.equal(buildResetPasswordRedirect("https://evil.example"), undefined);
assert.equal(buildResetPasswordRedirect("javascript:alert(1)"), undefined);

console.log(JSON.stringify({ validCaseCount: validCases.length, rejectedCaseCount: rejectedCases.length, callbackFallback: "/", navigationCalls: browserCalls.length, passwordRecoveryOriginChecked: true }));
