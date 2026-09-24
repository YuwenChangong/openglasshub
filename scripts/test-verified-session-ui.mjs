import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
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
}, load(id) { if (id === "\0test-browser") return "export const createBrowserSupabaseClient = () => globalThis.__testBrowserClient; export const syncBrowserRealtimeAuth = async () => 'local-token';"; } }, react()], server: { middlewareMode: true }, appType: "custom" });
try {
  const { default: AuthPanel } = await vite.ssrLoadModule("/src/components/forum/AuthPanel.tsx");
  const { default: AuthCallback } = await vite.ssrLoadModule("/src/components/auth/AuthCallback.tsx");
  const { default: LoginVerification } = await vite.ssrLoadModule("/src/components/auth/LoginVerification.tsx");
  const { default: ResetPasswordForm } = await vite.ssrLoadModule("/src/components/auth/ResetPasswordForm.tsx");
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
  const callbackRequestsBefore = requests.length;
  await act(async () => { callbackRoot.render(createElement(AuthCallback, {
    next: "%252f%252fevil.example", authAdapter: signedInAdapter,
    navigationAdapter: { ...navigation, replace: (url) => callbackNavigations.push(url) },
  })); await pause(); });
  await act(async () => { await pause(); });
  assert.deepEqual(callbackNavigations, [], "pending callback cannot enter login-code verification");
  assert.equal(requests.slice(callbackRequestsBefore).filter((call) => call.path.includes("login-challenge")).length, 0);
  assert.deepEqual([...document.querySelectorAll("a")].map((link) => [link.getAttribute("href"), link.textContent?.trim()]), [
    ["/login/?mode=signup&next=%2F", "输入注册验证码"],
    ["/login/?next=%2F", "使用密码登录"],
  ]);
  await act(async () => { callbackRoot.unmount(); });

  const pendingRoot = createRoot(document.getElementById("root"));
  const pendingRequestsBefore = requests.length;
  const restartEvents = [];
  await act(async () => { pendingRoot.render(createElement(AuthPanel, {
    next: "/me/", authAdapter: { ...signedInAdapter, signOut: async () => {
      assert.equal(requests.at(-1).path, "/api/auth/logout", "restart revokes before local sign-out");
      restartEvents.push("local-signout"); return null;
    } }, navigationAdapter: { ...navigation, navigate: () => restartEvents.push("navigate") },
  })); await pause(); });
  assert.equal(document.querySelector('input[autocomplete="one-time-code"]'), null, "reload has no usable challenge ID");
  assert.equal(button("重新发送验证码"), undefined, "reload must not offer unusable resend");
  assert.ok(button("使用密码重新登录"), "reload offers explicit restart");
  assert.equal(requests.slice(pendingRequestsBefore).filter((call) => call.path.includes("login-challenge")).length, 0);
  await act(async () => { button("使用密码重新登录").click(); await pause(); });
  assert.deepEqual(restartEvents, ["local-signout", "navigate"]);
  await act(async () => { pendingRoot.unmount(); });

  const signupRoot = createRoot(document.getElementById("root"));
  const signupRequestsBefore = requests.length;
  await act(async () => { signupRoot.render(createElement(AuthPanel, {
    next: "/me/", initialMode: "signup", authAdapter: signedInAdapter, navigationAdapter: navigation,
  })); await pause(); });
  assert.ok(button("已有注册验证码"), "signup callback has a separate code-entry path");
  await act(async () => { setValue(document.querySelector('input[type="email"]'), "user@example.test");
    button("已有注册验证码").click(); await pause(); });
  assert.ok(document.querySelector('input[autocomplete="one-time-code"]'), "signup code entry opens without password challenge");
  assert.equal(requests.slice(signupRequestsBefore).filter((call) => call.path.includes("login-challenge")).length, 0);
  await act(async () => { signupRoot.unmount(); });

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

  for (const unsafeNext of ["https://evil.example", "%252f%252fevil.example", "/%ZZ"]) {
    const destinations = [];
    const unsafeRoot = createRoot(document.getElementById("root"));
    await act(async () => { unsafeRoot.render(createElement(LoginVerification, {
      next: unsafeNext, initialChallengeId: sessionId, getAccessToken: async () => token,
      onVerified: (destination) => destinations.push(destination), onUsePassword: () => {},
    })); await pause(); });
    await act(async () => { setValue(document.querySelector('input[autocomplete="one-time-code"]'), "123456"); await pause(); });
    await act(async () => { button("验证").click(); await pause(); });
    assert.deepEqual(destinations, ["/"], `${unsafeNext} cannot become a continuation`);
    await act(async () => { unsafeRoot.unmount(); });
  }

  const recoveryEvents = [];
  const recoveryRequestsBefore = requests.length;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (new URL(input, "https://app.test").pathname === "/api/auth/logout") recoveryEvents.push("revoke");
    return priorFetch(input, init);
  };
  globalThis.__testBrowserClient = { auth: {
    getSession: async () => ({ data: { session: { access_token: token } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    updateUser: async () => { recoveryEvents.push("update-password"); return { error: null }; },
    signOut: async (options) => { recoveryEvents.push(`sign-out:${options.scope}`); return { error: null }; },
  } };
  const recoveryRoot = createRoot(document.getElementById("root"));
  await act(async () => { recoveryRoot.render(createElement(ResetPasswordForm, {
    onReturnToLogin: () => recoveryEvents.push("fresh-login"),
  })); await pause(); });
  await act(async () => { setValue(document.querySelector('input[autocomplete="new-password"]'), "newpassword123");
    setValue(document.querySelectorAll('input[autocomplete="new-password"]')[1], "newpassword123"); await pause(); });
  await act(async () => { button("更新密码").click(); await pause(); });
  assert.deepEqual(recoveryEvents, ["update-password", "revoke", "sign-out:local", "fresh-login"]);
  assert.equal(requests.slice(recoveryRequestsBefore).filter((call) => call.path.includes("login-challenge")).length, 0);
  await act(async () => { recoveryRoot.unmount(); });

  const { useBrowserAuthState } = await vite.ssrLoadModule("/src/components/auth/useBrowserAuthState.ts");
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  const { default: HeaderUserMenu } = await vite.ssrLoadModule("/src/components/site/HeaderUserMenu.tsx");
  const { default: HeaderNotifications } = await vite.ssrLoadModule("/src/components/site/HeaderNotifications.tsx");
  const { default: NotificationsPage } = await vite.ssrLoadModule("/src/components/notifications/NotificationsPage.tsx");
  let authListener;
  const authListeners = new Set();
  let currentSession = null;
  let browserState = "ANONYMOUS";
  let summaryStatus = 200;
  const privateCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(input, "https://app.test").pathname;
    privateCalls.push(path);
    if (path === "/api/auth/session-state") return browserState === "DB_UNAVAILABLE"
      ? json({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503) : json({ state: browserState, policy: "CURRENT" });
    if (path === "/api/users/me/summary") return summaryStatus === 500 ? json({ error: "FAILED" }, 500)
      : summaryStatus === 201 ? json({ ok: true })
      : json({ ok: true, profile: { id: userId, username: "tester", display_name: "Tester", avatar_url: null,
        role: "member", profile_href: "/users/tester/", avatar_resolved_url: null },
        stats: { post_count: 4, received_like_count: 8 } });
    if (path === "/api/users/me/notifications") return json({ ok: true, unread_count: 0, notifications: [] });
    if (path === "/api/auth/logout") return json({ ok: true });
    throw Error(`unexpected ${path}`);
  };
  globalThis.__testBrowserClient = { auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (callback) => { authListener = callback; authListeners.add(callback);
      return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } }; },
    signOut: async () => ({ error: null }),
  }, channel: () => { throw Error("pending must not subscribe"); } };
  function StateProbe() {
    const state = useBrowserAuthState(globalThis.__testBrowserClient);
    return createElement("output", null, `${state.status}:${state.user?.id ?? "none"}`);
  }
  const stateRoot = createRoot(document.getElementById("root"));
  await act(async () => { stateRoot.render(createElement(StateProbe)); await pause(); });
  assert.equal(document.querySelector("output").textContent, "signed_out:none");
  currentSession = { access_token: token, user: { id: userId } };
  browserState = "PENDING_VERIFICATION";
  await act(async () => { authListener("SIGNED_IN", currentSession); await pause(); });
  assert.equal(document.querySelector("output").textContent, "pending_verification:none");
  browserState = "VERIFIED_AUTHENTICATED";
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  assert.equal(document.querySelector("output").textContent, `signed_in:${userId}`);
  browserState = "DB_UNAVAILABLE";
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  assert.equal(document.querySelector("output").textContent, "error:none");
  browserState = "ANONYMOUS";
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  assert.equal(document.querySelector("output").textContent, "signed_out:none");
  await act(async () => { stateRoot.unmount(); });

  let finishStaleRequest;
  const regularFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => new URL(input, "https://app.test").pathname === "/api/auth/session-state"
    ? new Promise((resolve) => { finishStaleRequest = () => resolve(json({ state: "VERIFIED_AUTHENTICATED" })); })
    : regularFetch(input, init);
  currentSession = { access_token: token, user: { id: userId } };
  const staleRoot = createRoot(document.getElementById("root"));
  await act(async () => { staleRoot.render(createElement(StateProbe)); await pause(); });
  assert.equal(typeof finishStaleRequest, "function");
  await act(async () => { authListener("SIGNED_OUT", null); await pause(); });
  await act(async () => { finishStaleRequest(); await pause(); });
  assert.equal(document.querySelector("output").textContent, "signed_out:none", "late verification cannot restore logged-out UI");
  await act(async () => { staleRoot.unmount(); });
  globalThis.fetch = regularFetch;

  const headerRoot = createRoot(document.getElementById("root"));
  currentSession = null;
  await act(async () => { headerRoot.render(createElement(HeaderUserMenu, { next: "https://evil.example" })); await pause(); });
  assert.equal(document.querySelectorAll(".ogh-auth-inline a").length, 1);
  assert.equal(document.querySelector(".ogh-auth-inline a span:last-child")?.textContent?.trim(), "未登录");
  assert.equal(document.querySelector(".ogh-auth-inline a")?.getAttribute("href"), "/login/?next=%2F");
  currentSession = { access_token: token, user: { id: userId } };
  browserState = "PENDING_VERIFICATION";
  await act(async () => { authListener("SIGNED_IN", currentSession); await pause(); });
  assert.equal(document.querySelector('[aria-label="打开账户菜单"]'), null);
  assert.equal(document.querySelector('a[href="/me/"]'), null);
  assert.equal(privateCalls.filter((path) => path === "/api/users/me/summary").length, 0);
  summaryStatus = 500;
  browserState = "VERIFIED_AUTHENTICATED";
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  await act(async () => { await pause(); });
  assert.ok(document.querySelector('[aria-label="打开账户菜单"]'), "verified identity survives summary 500");
  await act(async () => { document.querySelector('[aria-label="打开账户菜单"]').click(); await pause(); });
  assert.equal(document.querySelector(".header-user-menu__stats"), null, "failed summary cannot show fabricated zeroes");
  assert.ok(document.querySelector('a[href="/me/edit/"]'));
  summaryStatus = 201;
  currentSession = { access_token: token, user: { id: userId } };
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  await act(async () => { await pause(); });
  assert.ok(document.querySelector('[aria-label="打开账户菜单"]'), "malformed summary keeps verified identity");
  assert.equal(document.querySelector(".header-user-menu__stats"), null, "malformed summary cannot show counters");
  summaryStatus = 200;
  currentSession = { access_token: token, user: { id: userId } };
  await act(async () => { authListener("TOKEN_REFRESHED", currentSession); await pause(); });
  await act(async () => { await pause(); });
  await act(async () => { document.querySelector('[aria-label="打开账户菜单"]').click(); await pause(); });
  assert.equal(document.querySelector(".header-user-menu__stats")?.textContent?.replace(/\s/g, ""), "发帖4获赞8");
  await act(async () => { headerRoot.unmount(); });

  const notificationRoot = createRoot(document.getElementById("root"));
  browserState = "PENDING_VERIFICATION";
  const notificationsBefore = privateCalls.filter((path) => path === "/api/users/me/notifications").length;
  await act(async () => { notificationRoot.render(createElement(HeaderNotifications)); await pause(); });
  assert.equal(document.querySelector(".header-notifications"), null);
  assert.equal(privateCalls.filter((path) => path === "/api/users/me/notifications").length, notificationsBefore);
  await act(async () => { notificationRoot.unmount(); });

  const notificationsPageRoot = createRoot(document.getElementById("root"));
  await act(async () => { notificationsPageRoot.render(createElement(NotificationsPage)); await pause(); });
  assert.equal(privateCalls.filter((path) => path === "/api/users/me/notifications").length, notificationsBefore);
  assert.ok(document.querySelector(".notifications-page__signed-out"), "pending cannot view private notifications");
  await act(async () => { notificationsPageRoot.unmount(); });

  const { default: PostSocialActions } = await vite.ssrLoadModule("/src/components/forum/PostSocialActions.tsx");
  const { default: CommentsSection } = await vite.ssrLoadModule("/src/components/forum/CommentsSection.tsx");
  const { default: MyProfilePage } = await vite.ssrLoadModule("/src/components/profile/MyProfilePage.tsx");
  const { default: EditProfileForm } = await vite.ssrLoadModule("/src/components/profile/EditProfileForm.tsx");
  const channels = [];
  const removedChannels = [];
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }),
    then(resolve) { return Promise.resolve({ count: 0, data: [], error: null }).then(resolve); } };
  globalThis.__testBrowserClient.from = () => query;
  globalThis.__testBrowserClient.channel = (name) => {
    const channel = { name, on() { return this; }, subscribe() { return this; } };
    channels.push(channel);
    return channel;
  };
  globalThis.__testBrowserClient.removeChannel = async (channel) => { removedChannels.push(channel); };
  const realtimeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (new URL(input, "https://app.test").pathname === "/api/forum/comments") return json({ comments: [] });
    return realtimeFetch(input, init);
  };
  currentSession = { access_token: token, user: { id: userId } };
  browserState = "PENDING_VERIFICATION";
  const socialRoot = createRoot(document.getElementById("root"));
  await act(async () => { socialRoot.render(createElement("div", null,
    createElement(PostSocialActions, { postId: "post-1" }), createElement(CommentsSection, { postId: "post-1" }))); await pause(); });
  assert.equal(channels.length, 0, "pending session has no private post/comment subscriptions");
  browserState = "VERIFIED_AUTHENTICATED";
  await act(async () => { for (const listener of authListeners) listener("TOKEN_REFRESHED", currentSession); await pause(); });
  await act(async () => { await pause(); });
  assert.deepEqual(channels.map((channel) => channel.name).sort(), ["forum-comments-post-1", "forum-post-votes-post-1"]);
  browserState = "PENDING_VERIFICATION";
  await act(async () => { for (const listener of authListeners) listener("TOKEN_REFRESHED", currentSession); await pause(); });
  assert.equal(removedChannels.length, 2, "verified-state loss removes both channels");
  await act(async () => { socialRoot.unmount(); });

  browserState = "PENDING_VERIFICATION";
  const profileRoot = createRoot(document.getElementById("root"));
  const profileQueries = [];
  globalThis.__testBrowserClient.from = (table) => { profileQueries.push(table); return query; };
  await act(async () => { profileRoot.render(createElement("div", null,
    createElement(MyProfilePage), createElement(EditProfileForm))); await pause(); });
  assert.equal(profileQueries.length, 0, "pending session does not read owner profile data");
  assert.equal(document.querySelector('a[href="/me/edit/"]'), null, "pending session has no profile navigation");
  await act(async () => { profileRoot.unmount(); });
} finally { await vite.close(); dom.window.close(); }
console.log("PASS verified-session UI and logout boundary");
