import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { parsePreferenceCookie, serializePreferenceCookie, writeBrowserPreference } from "../src/lib/i18n/preference-cookie.ts";
import { createLocaleStore } from "../src/lib/i18n/locale-store.ts";

const record = (preference = "en", generation = 1, provenance = "device_explicit") => ({ version: 1, preference, generation, provenance });
const encode = (value) => encodeURIComponent(JSON.stringify(value));
const initial = { locale: "en", preference: "auto", source: "country", autoLocale: "en", generation: 0, provenance: null };
test("cookie persists exactly the nonsensitive record with host-only secure attrs", () => {
  const serialized = serializePreferenceCookie(record("zh-CN"));
  assert.match(serialized, /^ogh_preferences_v1=/);
  assert.match(serialized, /; Path=\/; Secure; SameSite=Lax; Max-Age=15552000$/);
  assert.doesNotMatch(serialized, /Domain=|HttpOnly/);
  assert.deepEqual(parsePreferenceCookie(serialized.split(";")[0].split("=")[1]), record("zh-CN"));
});
for (const value of [undefined, "", "%", encode(null), encode([]), encode({}), encode({ ...record(), version: 2 }), encode({ ...record(), preference: "fr" }), encode({ ...record(), generation: -1 }), encode({ ...record(), generation: 0.5 }), encode({ ...record(), generation: Number.MAX_SAFE_INTEGER + 1 }), encode({ ...record(), provenance: "identity" }), "x".repeat(513), ...["theme", "country", "token", "userId"].map(key => encode({ ...record(), [key]: "forbidden" }))]) {
  test(`reject malformed or expanded record ${String(value).slice(0,65)}`, () => assert.equal(parsePreferenceCookie(value), undefined));
}
test("serializer refuses extra fields rather than persisting them", () => assert.throws(() => serializePreferenceCookie({ ...record(), country: "CN" }), /preference/i));
test("real secure browser cookie write is verified by readback", () => {
  const dom = new JSDOM("", { url: "https://example.test/settings/" });
  globalThis.document = dom.window.document;
  try { assert.equal(writeBrowserPreference(record("zh-CN")), true); assert.deepEqual(parsePreferenceCookie(document.cookie.split("=")[1]), record("zh-CN")); }
  finally { delete globalThis.document; dom.window.close(); }
});
test("denied cookie returns false without exposing a persistence claim", () => {
  globalThis.document = { get cookie() { throw new Error("denied"); }, set cookie(_) { throw new Error("denied"); } };
  try { assert.equal(writeBrowserPreference(record()), false); }
  finally { delete globalThis.document; }
});
function fixture(start = initial, writeAllowed = true) {
  const events = []; let cookie; let external;
  const store = createLocaleStore(start, {
    writePreference(value) { events.push("write"); if (writeAllowed) cookie = value; return writeAllowed; },
    readPreference() { return cookie; },
    navigate() { events.push("navigate"); },
    publish(value) { events.push(["publish", value]); },
    subscribeExternal(callback) { external = callback; return () => { external = undefined; }; },
  });
  const unsubscribe = store.subscribe(() => events.push("notify"));
  return { store, events, unsubscribe, incoming(value) { cookie = value; external(value); } };
}
test("SSR snapshot ignores hostile localStorage and stays request-local", () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("must not read"); } });
  try { const a = fixture(); const b = fixture(); assert.strictEqual(a.store.getServerSnapshot(), initial); a.store.select("zh-CN"); assert.strictEqual(b.store.getSnapshot(), initial); a.unsubscribe(); b.unsubscribe(); }
  finally { delete globalThis.localStorage; }
});
test("manual choice notifies immediately and writes before one coherent navigation", () => {
  const f = fixture();
  assert.equal(f.store.select("zh-CN"), true);
  assert.equal(f.store.getSnapshot().locale, "zh-CN");
  assert.deepEqual(f.events.map(e => Array.isArray(e) ? e[0] : e), ["write", "notify", "publish", "navigate"]);
  assert.deepEqual(f.events[2][1], record("zh-CN"));
  f.unsubscribe();
});
test("blocked persistence keeps in-memory choice with no publish or reload", () => {
  const f = fixture(initial, false);
  assert.equal(f.store.select("zh-CN"), false);
  assert.equal(f.store.getSnapshot().locale, "zh-CN");
  assert.deepEqual(f.events, ["write", "notify"]); f.unsubscribe();
});
test("Auto restores detection language rather than previous manual lock", () => {
  const f = fixture({ ...initial, locale: "zh-CN", preference: "zh-CN", provenance: "device_explicit" });
  f.store.select("auto"); assert.equal(f.store.getSnapshot().locale, "en"); assert.equal(f.store.getSnapshot().preference, "auto"); f.unsubscribe();
});
test("stale and duplicate cross-tab records cannot overwrite a newer selection or reload twice", () => {
  const f = fixture(); f.store.select("zh-CN");
  f.incoming(record("en", 0)); assert.equal(f.store.getSnapshot().locale, "zh-CN");
  f.incoming(record("en", 2)); assert.equal(f.store.getSnapshot().locale, "en");
  f.incoming(record("zh-CN", 2)); assert.equal(f.store.getSnapshot().locale, "en");
  assert.equal(f.events.filter(e => e === "navigate").length, 2); f.unsubscribe();
});
test("stale account fetch cannot overwrite manual choice", () => {
  const f = fixture(); f.store.select("zh-CN");
  assert.equal(f.store.adoptAccount({ locale_preference: "en", revision: 1, updated_at: "2026-10-01T00:00:00Z" }, 0), false);
  assert.equal(f.store.getSnapshot().locale, "zh-CN"); f.unsubscribe();
});
test("eligible account adoption reloads once; logout clears only adopted preference", () => {
  const f = fixture(); const snapshot = { locale_preference: "zh-CN", revision: 1, updated_at: "2026-10-01T00:00:00Z" };
  assert.equal(f.store.adoptAccount(snapshot, 0), true);
  assert.equal(f.store.getSnapshot().provenance, "account_adopted");
  assert.equal(f.store.adoptAccount(snapshot, 1), false);
  f.store.clearAccount(); assert.equal(f.store.getSnapshot().preference, "auto");
  assert.equal(f.store.getSnapshot().locale, "en"); f.unsubscribe();
  const manual = fixture(); manual.store.select("zh-CN"); manual.store.clearAccount(); assert.equal(manual.store.getSnapshot().locale, "zh-CN"); manual.unsubscribe();
});
test("overflow reinitializes rather than creating an unsafe generation", () => {
  const f = fixture({ ...initial, generation: Number.MAX_SAFE_INTEGER }); f.store.select("zh-CN");
  assert.equal(f.store.getSnapshot().generation, 0); assert.equal(f.events[2][1].generation, 0); f.unsubscribe();
});
