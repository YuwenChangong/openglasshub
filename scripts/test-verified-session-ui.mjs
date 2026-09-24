import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = {}", shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.(?:ts|tsx|js|mjs)$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const { handleLogout } = await import("../src/pages/api/auth/logout.ts");
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const otherSessionId = "33333333-3333-4333-8333-333333333333";
const secret = "local-only-test-secret";
const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function tokenFor(id = sessionId) {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: `${env.SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated",
    sub: userId, session_id: id, exp: Math.floor(Date.now() / 1000) + 3600,
    is_anonymous: false, amr: [{ method: "password" }],
  })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const token = tokenFor();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function logout(authToken, { live = true, revoke = true, serviceDown = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === "/auth/v1/user") return live && init.headers?.Authorization === `Bearer ${token}`
      ? json({ id: userId }) : json({ message: "invalid" }, 401);
    if (path === "/rest/v1/rpc/ogh_revoke_verified_session") return serviceDown ? json({ message: "offline" }, 503) : json(revoke);
    throw Error(`unexpected ${path}`);
  };
  try {
    const response = await handleLogout(new Request("https://app.test/api/auth/logout", {
      method: "POST", headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    }), env);
    return { response, data: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}
const missing = await logout(null);
assert.equal(missing.response.status, 401);
assert.equal(missing.calls.length, 0);
const forged = await logout(`${token.slice(0, -1)}x`);
assert.notEqual(forged.response.status, 200);
assert.ok(!forged.calls.some((call) => call.path.endsWith("ogh_revoke_verified_session")));
const stale = await logout(token, { live: false });
assert.notEqual(stale.response.status, 200);
assert.ok(!stale.calls.some((call) => call.path.endsWith("ogh_revoke_verified_session")));
const ok = await logout(token);
assert.equal(ok.response.status, 200);
assert.equal(ok.response.headers.get("cache-control"), "no-store");
assert.deepEqual(ok.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_revoke_verified_session"]);
assert.deepEqual(ok.calls.at(-1).body, { p_user_id: userId, p_session_id: sessionId });
assert.ok(!JSON.stringify(ok.calls).includes(otherSessionId));
for (const options of [{ revoke: false }, { serviceDown: true }]) {
  const failed = await logout(token, options);
  assert.notEqual(failed.response.status, 200);
}

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.test/login/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
globalThis.React = (await import("react")).default;
const vite = await createServer({ plugins: [{ name: "mock-browser", enforce: "pre", resolveId(id) {
  if (id.endsWith("/lib/supabase-browser") || id.endsWith("/lib/supabase-browser.ts")) return "\0test-browser";
}, load(id) { if (id === "\0test-browser") return "export const createBrowserSupabaseClient = () => globalThis.__testBrowserClient;"; } }, react()], server: { middlewareMode: true }, appType: "custom" });
try {
  const { default: AuthPanel } = await vite.ssrLoadModule("/src/components/forum/AuthPanel.tsx");
  const { default: AuthCallback } = await vite.ssrLoadModule("/src/components/auth/AuthCallback.tsx");
  const { default: LoginVerification } = await vite.ssrLoadModule("/src/components/auth/LoginVerification.tsx");
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setValue = (node, value) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const button = (label) => [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
  const requests = [];
  const navigations = [];
  const signOuts = [];
  let verifyError = null;
  let revokeError = null;
  let sessionState = "PENDING_VERIFICATION";
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(input, "https://app.test").pathname;
    requests.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === "/api/auth/login-challenge/start") return json({ status: "SENT", challengeId: sessionId });
    if (path === "/api/auth/login-challenge/resend") return json({ status: "SENT", challengeId: otherSessionId });
    if (path === "/api/auth/login-challenge/verify") return verifyError ? json({ error: verifyError }, 400) : json({ status: "VERIFIED", next: "/me/" });
    if (path === "/api/auth/logout") return revokeError ? json({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503) : json({ ok: true });
    if (path === "/api/auth/session-state") return json({ state: sessionState, policy: "CURRENT" });
    throw Error(`unexpected ${path}`);
  };
  globalThis.__testBrowserClient = { auth: {
    getSession: async () => ({ data: { session: { access_token: token, user: { id: userId } } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async (options) => { signOuts.push(options); return { error: null }; },
  } };
  const adapter = { viewState: "signed_out", getSession: async () => ({ accessToken: token }),
    signInWithPassword: async () => ({ data: { accessToken: token }, error: null }) };
  const consent = { recordCurrentConsent: async () => ({ current: true }) };
  const navigation = { navigate: (url) => navigations.push(url), replace: (url) => navigations.push(url), getCurrentUrl: () => "/login/" };
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(createElement(AuthPanel, { next: "https://evil.example", authAdapter: adapter, consentAdapter: consent, navigationAdapter: navigation })); await pause(); });
  await act(async () => { setValue(document.querySelector('input[type="email"]'), "user@example.test"); setValue(document.querySelector('input[type="password"]'), "password123"); document.querySelector('input[type="checkbox"]').click(); await pause(); });
  await act(async () => { document.querySelector('form.auth-form button[type="submit"]').click(); await pause(); });
  assert.equal(navigations.length, 0, "password success stays pending");
  assert.equal(requests.filter((call) => call.path.endsWith("/start")).length, 1, "one start");
  assert.ok(document.querySelector('input[autocomplete="one-time-code"]'));
  await act(async () => { setValue(document.querySelector('input[autocomplete="one-time-code"]'), "123456"); await pause(); });
  for (const error of ["CHALLENGE_INVALID", "CHALLENGE_EXPIRED", "CHALLENGE_EXHAUSTED"]) {
    verifyError = error;
    await act(async () => { button("验证").click(); await pause(); });
    assert.equal(navigations.length, 0, `${error} cannot navigate`);
  }
  verifyError = null;
  await act(async () => { button("验证").click(); await pause(); });
  assert.deepEqual(navigations, ["/"], "unsafe next stays internal even when endpoint suggests a different path");
  await act(async () => { root.unmount(); });
  assert.equal(window.localStorage.length, 0, "challenge is not persisted");
  assert.equal(signOuts.length, 0, "verification does not sign out");
  assert.equal(revokeError, null);

  const logoutEvents = [];
  let localSignOutError = false;
  const signedInAdapter = { viewState: "signed_in", userPresent: true,
    getSession: async () => ({ accessToken: token }),
    signOut: async () => { logoutEvents.push("local-signout"); return localSignOutError ? new Error("local sign-out failed") : null; } };
  const signedInNavigation = { ...navigation, navigate: (url) => { logoutEvents.push("navigate"); navigations.push(url); } };
  sessionState = "VERIFIED_AUTHENTICATED";
  const logoutRoot = createRoot(document.getElementById("root"));
  await act(async () => { logoutRoot.render(createElement(AuthPanel, { authAdapter: signedInAdapter, navigationAdapter: signedInNavigation })); await pause(); });
  assert.ok(button("退出登录"));
  revokeError = "VERIFICATION_SERVICE_UNAVAILABLE";
  await act(async () => { button("退出登录").click(); await pause(); });
  assert.deepEqual(logoutEvents, [], "failed revocation leaves local session intact");
  assert.ok(document.querySelector('.auth-alert--error')?.textContent?.includes("退出登录失败"));
  revokeError = null;
  localSignOutError = true;
  await act(async () => { button("退出登录").click(); await pause(); });
  assert.deepEqual(logoutEvents, ["local-signout"], "failed local sign-out does not navigate");
  assert.ok(document.querySelector('.auth-alert--error')?.textContent?.includes("本地退出失败"));
  localSignOutError = false;
  await act(async () => { button("退出登录").click(); await pause(); });
  assert.deepEqual(logoutEvents, ["local-signout", "local-signout", "navigate"], "local sign-out follows revocation");
  await act(async () => { logoutRoot.unmount(); });

  sessionState = "PENDING_VERIFICATION";
  const callbackRoot = createRoot(document.getElementById("root"));
  const callbackNavigations = [];
  await act(async () => { callbackRoot.render(createElement(AuthCallback, {
    next: "%252f%252fevil.example", authAdapter: signedInAdapter,
    navigationAdapter: { ...navigation, replace: (url) => callbackNavigations.push(url) },
  })); await pause(); });
  assert.deepEqual(callbackNavigations, ["/login/?next=%2F"], "generic callback stays pending and uses safe next");
  await act(async () => { callbackRoot.unmount(); });

  const originalNow = Date.now;
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;
  let clock = originalNow();
  let tick;
  Date.now = () => clock;
  window.setInterval = (callback) => { tick = callback; return 1; };
  window.clearInterval = () => {};
  try {
    const resendRoot = createRoot(document.getElementById("root"));
    await act(async () => { resendRoot.render(createElement(LoginVerification, {
      next: "/me/", initialChallengeId: sessionId, getAccessToken: async () => token,
      onVerified: () => {}, onUsePassword: () => {},
    })); await pause(); });
    assert.equal(button("重新发送验证码").disabled, true);
    assert.equal(typeof tick, "function", "cooldown schedules an expiry update");
    clock += 60_000;
    await act(async () => { tick(); await pause(); });
    assert.equal(button("重新发送验证码").disabled, false, "resend becomes available at cooldown expiry");
    await act(async () => { button("重新发送验证码").click(); await pause(); });
    assert.equal(requests.at(-1).path, "/api/auth/login-challenge/resend");
  await act(async () => { resendRoot.unmount(); });
  } finally {
    Date.now = originalNow;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
  }

  const consentRoot = createRoot(document.getElementById("root"));
  const consentNavigation = [];
  await act(async () => { consentRoot.render(createElement(AuthPanel, {
    next: "/me/", authAdapter: adapter,
    consentAdapter: { recordCurrentConsent: async () => { throw new Error("policy unavailable"); } },
    navigationAdapter: { ...navigation, navigate: (url) => consentNavigation.push(url) },
  })); await pause(); });
  await act(async () => { setValue(document.querySelector('input[type="email"]'), "user@example.test");
    setValue(document.querySelector('input[type="password"]'), "password123");
    document.querySelector('input[type="checkbox"]').click(); await pause(); });
  const startsBefore = requests.filter((call) => call.path.endsWith("/start")).length;
  await act(async () => { document.querySelector('form.auth-form button[type="submit"]').click(); await pause(); });
  assert.equal(consentNavigation.length, 0, "policy failure does not leave pending verification");
  assert.equal(requests.filter((call) => call.path.endsWith("/start")).length, startsBefore + 1);
  await act(async () => { setValue(document.querySelector('input[autocomplete="one-time-code"]'), "123456"); await pause(); });
  await act(async () => { button("验证").click(); await pause(); });
  assert.ok(consentNavigation[0]?.startsWith("/legal-consent/?next="), "verified session completes policy separately");
  await act(async () => { consentRoot.unmount(); });
} finally { await vite.close(); dom.window.close(); }

for (const path of ["src/pages/login/index.astro", "src/pages/auth/callback.astro", "src/components/auth/AuthCallback.tsx", "src/components/auth/ResetPasswordForm.tsx"]) {
  const source = await readFile(path, "utf8");
  assert.ok(source.includes("getSafeNext") || source.includes("/login/"), `${path} retains a safe continuation`);
}
console.log("PASS verified-session UI and logout boundary");
