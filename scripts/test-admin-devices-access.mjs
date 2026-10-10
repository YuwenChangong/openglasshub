import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const dom = new JSDOM("<div id='root'></div>", { url: "http://127.0.0.1/admin/devices/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const vite = await createServer({ plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createAdminDevicesDashboard } = await vite.ssrLoadModule("/src/components/admin/AdminDevicesDashboard.tsx");
const { AdminApiError } = await vite.ssrLoadModule("/src/lib/admin-api-client.ts");
const { resolveLocale } = await vite.ssrLoadModule("/src/lib/i18n/locale.ts");
const session = { access_token: "local-fixture", user: { id: "admin-a" } };
const ready = (role = "admin") => ({ status: "ready", message: "", session, me: { role, allowed: true, user_id: "admin-a" } });
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function mount(state, fetcher = async () => ({ devices: [{ id: "local-device", name: "Local Device", slug: "local-device", brandName: "Fixture", publicationStatus: "draft" }] })) {
  let setState;
  const calls = [];
  const Dashboard = createAdminDevicesDashboard({
    useSession() {
      const [current, update] = React.useState(state);
      setState = update;
      return { state: current, setState: update, session: current.status === "ready" ? current.session : null, me: current.status === "ready" ? current.me : null, refresh() {} };
    },
    fetchAdmin: async (...args) => { calls.push(args); return fetcher(...args); },
  });
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(Dashboard, { localeContext: resolveLocale({ acceptLanguage: "en" }) })));
  return { calls, update: async (next) => React.act(async () => setState(next)), text: () => document.body.textContent, close: async () => React.act(async () => root.unmount()) };
}
function noManagement() { assert.equal(document.querySelectorAll("form,input,textarea,.admin-news-toolbar__filters").length, 0); }
try {
  for (const status of ["checking", "signed_out", "forbidden", "error", "timeout"]) {
    await test(`access:${status}`, async () => {
      const h = await mount({ status, message: "RAW_PROVIDER_ERROR_MUST_NOT_RENDER" });
      try { noManagement(); assert.equal(h.calls.length, 0); assert.ok(!h.text().includes("Loading devices")); assert.ok(!h.text().includes("RAW_PROVIDER")); if (status === "signed_out") assert.equal(document.querySelector("a").getAttribute("href"), "/login/?next=%2Fadmin%2Fdevices%2F"); }
      finally { await h.close(); }
    });
  }
  await test("moderator cannot see device management", async () => { const h = await mount(ready("moderator")); try { noManagement(); assert.equal(h.calls.length, 0); } finally { await h.close(); } });
  for (const invalid of [{ ...ready(), me: { role: "admin", allowed: false } }, { ...ready(), session: { access_token: "" } }]) await test("incomplete authorization fails closed", async () => { const h = await mount(invalid); try { noManagement(); assert.equal(h.calls.length, 0); } finally { await h.close(); } });
  await test("verified admin loads devices", async () => { const h = await mount(ready()); try { assert.ok(h.text().includes("Local Device")); assert.equal(h.calls.length, 1); assert.ok(document.querySelector("form")); } finally { await h.close(); } });
  for (const status of [401, 403, 500]) await test(`list error:${status}`, async () => {
    const h = await mount(ready(), async () => { throw new AdminApiError("RAW_PROVIDER_ERROR", status); });
    try { assert.ok(!h.text().includes("RAW_PROVIDER")); assert.ok(!h.text().includes("No devices")); if (status !== 500) noManagement(); assert.ok(document.querySelector("[role=alert]") || document.querySelector(".admin-state-message")); }
    finally { await h.close(); }
  });
  await test("malformed successful list does not pretend there are zero devices", async () => { const h = await mount(ready(), async () => ({})); try { assert.ok(document.querySelector("[role=alert]")); assert.ok(!h.text().includes("No devices")); } finally { await h.close(); } });
  await test("malformed list items show a safe load failure", async () => { const h = await mount(ready(), async () => ({ devices: [null] })); try { assert.ok(document.querySelector("[role=alert]")); } finally { await h.close(); } });
  await test("logout discards an unresolved old-account response", async () => {
    let release;
    const h = await mount(ready(), () => new Promise(resolve => { release = resolve; }));
    try { await h.update({ status: "signed_out", message: "" }); noManagement(); await React.act(async () => release({ devices: [{ name: "STALE_PRIVATE_DEVICE" }] })); assert.ok(!h.text().includes("STALE_PRIVATE_DEVICE")); }
    finally { await h.close(); }
  });
  await test("sign-in and account switch clear prior form and devices", async () => {
    const h = await mount({ status: "signed_out", message: "" });
    try {
      await h.update(ready()); assert.ok(h.text().includes("Local Device"));
      await React.act(async () => document.querySelector(".admin-news-card").click());
      const name = () => [...document.querySelectorAll("input")].find(input => input.value === "Local Device");
      assert.ok(name());
      await h.update({ ...ready(), session: { access_token: "other-local-fixture", user: { id: "admin-b" } }, me: { role: "admin", allowed: true, user_id: "admin-b" } });
      assert.equal(name(), undefined); assert.equal(h.calls.length, 2);
    } finally { await h.close(); }
  });
  await test("token refresh preserves same-account unsaved form through checking", async () => {
    const h = await mount(ready());
    try {
      await React.act(async () => document.querySelector(".admin-news-card").click());
      await h.update({ status: "checking", message: "" }); noManagement();
      await h.update({ ...ready(), session: { ...session, access_token: "refreshed-local-token" } });
      assert.ok([...document.querySelectorAll("input")].some(input => input.value === "Local Device"));
    } finally { await h.close(); }
  });
  await test("pending mutation is isolated by account generation", async () => {
    const pending = [];
    const h = await mount(ready(), async (_path, options) => options.method ? new Promise(resolve => pending.push(resolve)) : { devices: [] });
    const submit = () => document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    try {
      await React.act(async () => submit()); assert.equal(pending.length, 1);
      await h.update({ status: "signed_out", message: "" });
      await h.update({ ...ready(), session: { access_token: "other-local-fixture", user: { id: "admin-b" } }, me: { role: "admin", allowed: true, user_id: "admin-b" } });
      assert.equal(document.querySelector("button[type=submit]").disabled, false);
      await React.act(async () => submit()); assert.equal(pending.length, 2);
      await React.act(async () => pending[0]({})); assert.equal(document.querySelector("button[type=submit]").disabled, true);
      await React.act(async () => pending[1]({})); assert.equal(document.querySelector("button[type=submit]").disabled, false);
    } finally { await h.close(); }
  });
  await test("old mutation readback cannot clear a new account form", async () => {
    let release, reads = 0;
    const list = { devices: [{ id: "local-device", name: "Local Device", slug: "local-device", brandName: "Fixture", publicationStatus: "draft" }] };
    const h = await mount(ready(), async (_path, options) => {
      if (options.method) return {};
      if (options.session.access_token === session.access_token && ++reads === 2) return new Promise(resolve => { release = resolve; });
      return list;
    });
    try {
      await React.act(async () => document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      assert.equal(typeof release, "function");
      await h.update({ ...ready(), session: { access_token: "other-local-fixture", user: { id: "admin-b" } }, me: { role: "admin", allowed: true, user_id: "admin-b" } });
      await React.act(async () => document.querySelector(".admin-news-card").click());
      await React.act(async () => release(list));
      assert.ok([...document.querySelectorAll("input")].some(input => input.value === "Local Device"));
    } finally { await h.close(); }
  });
  await test("list deadline leaves loading and supports manual retry", async () => {
    const original = globalThis.setTimeout;
    let expire;
    globalThis.setTimeout = (fn, ms, ...rest) => { if (ms === 15000) { expire = fn; return original(() => {}, 60000); } return original(fn, ms, ...rest); };
    let attempts = 0;
    const h = await mount(ready(), async () => { if (++attempts === 1) return new Promise(() => {}); return { devices: [] }; });
    globalThis.setTimeout = original;
    try { assert.equal(typeof expire, "function"); await React.act(async () => expire()); assert.ok(!h.text().includes("Loading devices")); assert.ok(document.querySelector("[role=alert]")); await React.act(async () => document.querySelector("[role=alert] button").click()); assert.equal(h.calls.length, 2); }
    finally { await h.close(); }
  });
  await test("Astro route does not expose an ungated management heading", async () => {
    const source = await readFile(new URL("../src/pages/admin/devices/index.astro", import.meta.url), "utf8");
    assert.ok(!source.includes("<h1")); assert.ok(!source.includes("text.pages.devices.lead}"));
  });
  console.log(`ADMIN_ACCESS_TESTS=${passed}/${passed}`);
} finally { await vite.close(); dom.window.close(); }
