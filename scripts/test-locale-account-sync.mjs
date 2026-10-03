import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocaleStore } from "../src/lib/i18n/locale-store.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { createPreferenceSync, canAdoptOnRoute } from "../src/lib/i18n/preference-sync.ts";
import { loadOwnPreference, saveOwnPreference, PreferenceClientError } from "../src/lib/i18n/preference-client.ts";

const row = (locale = "zh-CN", revision = 1) => ({ locale_preference: locale, revision, updated_at: "2026-10-01T00:00:00Z" });
function fixture(saved, options = {}) {
  const calls = { writes: [], loads: [], saves: [], navigation: 0 };
  const store = createLocaleStore(resolveLocale({ saved }), {
    writePreference: record => { calls.writes.push(record); return true; }, navigate: () => calls.navigation++,
  });
  const sync = createPreferenceSync(store, {
    load: async actor => { calls.loads.push(actor); return row(); },
    save: async (actor, preference, revision) => { calls.saves.push({ actor, preference, revision }); return row(preference, revision + 1); }, ...options,
  });
  return { sync, store, calls };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test("adopts once without uploading inferred or explicit device choice", async () => {
  const f = fixture(); await f.sync.setActor("A"); await f.sync.setActor("A");
  assert.equal(f.store.getSnapshot().locale, "zh-CN"); assert.equal(f.calls.navigation, 1); assert.deepEqual(f.calls.saves, []); assert.deepEqual(f.calls.loads, ["A"]);
  const explicit = fixture({ version: 1, preference: "en", generation: 1, provenance: "device_explicit" });
  await explicit.sync.setActor("A"); assert.equal(explicit.store.getSnapshot().locale, "en"); assert.deepEqual(explicit.calls.saves, []);
});
test("manual choice beats stale load", async () => {
  const d = deferred(), f = fixture(undefined, { load: () => d.promise });
  const pending = f.sync.setActor("A"); f.store.select("en"); d.resolve(row()); await pending;
  assert.equal(f.store.getSnapshot().locale, "en"); assert.equal(f.store.getSnapshot().provenance, "device_explicit");
});
test("actor switch and logout cancel old account responses", async () => {
  const a = deferred(), b = deferred(); const signals = [];
  const f = fixture(undefined, { load: (actor, signal) => { signals.push(signal); return actor === "A" ? a.promise : b.promise; } });
  const old = f.sync.setActor("A"), current = f.sync.setActor("B");
  assert.equal(signals[0].aborted, true); a.resolve(row()); b.resolve(row("en", 2)); await Promise.all([old, current]);
  assert.equal(f.sync.getSnapshot().account.locale_preference, "en");
  await f.sync.setActor(null); assert.equal(f.sync.getSnapshot().account, null);
  assert.equal(f.store.getSnapshot().preference, "auto");
});
test("logout clears adopted choices but retains device explicit", async () => {
  const f = fixture(); await f.sync.setActor("A"); f.store.select("en"); await f.sync.setActor(null);
  assert.equal(f.store.getSnapshot().preference, "en"); assert.equal(f.store.getSnapshot().provenance, "device_explicit");
});
test("failure does not gate Auth or erase browser choice", async () => {
  const f = fixture(undefined, { load: async () => { throw new Error("private provider payload"); } });
  await f.sync.setActor("A"); assert.equal(f.sync.getSnapshot().status, "unavailable"); assert.equal(f.store.getSnapshot().preference, "auto");
  assert.equal(JSON.stringify(f.sync.getSnapshot()).includes("private"), false);
});
test("protected form defers adoption rather than losing URL tokens", async () => {
  const f = fixture(undefined, { canAdopt: () => false }); await f.sync.setActor("A");
  assert.equal(f.calls.navigation, 0); assert.equal(f.store.getSnapshot().preference, "auto");
});
test("manual save keeps choice and surfaces conflict with latest account row", async () => {
  let loads = 0;
  const f = fixture(undefined, { load: async () => row(++loads === 1 ? "en" : "zh-CN", loads), save: async () => { throw new PreferenceClientError("CONFLICT"); } });
  await f.sync.setActor("A"); await f.sync.save("en");
  assert.equal(f.store.getSnapshot().preference, "en"); assert.equal(f.sync.getSnapshot().status, "conflict");
  assert.equal(f.sync.getSnapshot().account.locale_preference, "zh-CN");
});
test("successful manual save uses known revision with no automatic upload", async () => {
  const f = fixture(); await f.sync.setActor("A"); await f.sync.save("en");
  assert.deepEqual(f.calls.saves, [{ actor: "A", preference: "en", revision: 1 }]); assert.equal(f.sync.getSnapshot().status, "saved");
});
test("pending load settles within three seconds even if transport ignores abort", async () => {
  const f = fixture(undefined, { load: () => new Promise(() => {}) });
  const start = Date.now(); await f.sync.setActor("A");
  assert.equal(f.sync.getSnapshot().status, "unavailable"); assert.ok(Date.now() - start < 3800);
});
test("client uses only own same-origin API and validates response", async () => {
  const calls = []; const client = { actor: "A", auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true, preference: row() }); } };
  assert.deepEqual(await loadOwnPreference(client, new AbortController().signal), row());
  await saveOwnPreference(client, "en", 1, new AbortController().signal);
  assert.deepEqual(calls.map(call => call.url), ["/api/users/me/preferences", "/api/users/me/preferences"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { locale_preference: "en", expected_revision: 1 });
  assert.equal(calls[0].init.cache, "no-store");
});
test("client discards actor-changed session before request", async () => {
  let calls = 0; const client = { actor: "A", auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "B" } } } }) }, fetch: async () => { calls++; return Response.json(row()); } };
  await assert.rejects(loadOwnPreference(client, new AbortController().signal), error => error.code === "SIGNED_OUT"); assert.equal(calls, 0);
});
test("client maps provider payload to safe allowlisted codes", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async () => Response.json({ error: "private payload" }, { status: 409 }) };
  await assert.rejects(saveOwnPreference(client, "en", 0, new AbortController().signal), error => error.code === "CONFLICT" && !error.message.includes("private"));
});
for (const [status, code] of [[503, "UNAVAILABLE"], [409, "CONFLICT"], [401, "SIGNED_OUT"], [400, "UNAVAILABLE"]]) {
  test(`client consumes ${status} response once before publishing ${code}`, async () => {
    const response = Response.json({ ok: false, code: "private provider detail" }, { status });
    let jsonCalls = 0;
    const nativeJson = response.json.bind(response);
    response.json = () => { jsonCalls++; return nativeJson(); };
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) },
      fetch: async () => response };
    await assert.rejects(saveOwnPreference(client, "en", 1, new AbortController().signal), error => error.code === code && !error.message.includes("private"));
    assert.equal(response.bodyUsed, true, "NON_2XX_BODY_CONSUMED_BEFORE_SEMANTIC_FAILURE");
    assert.equal(jsonCalls, 1, "NON_2XX_BODY_CONSUMED_EXACTLY_ONCE");
  });
}
test("client waits for complete error body before returning unavailable", async () => {
  let closeBody, consumed = false, semanticSettled = false;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"ok":false}'));
    closeBody = () => { consumed = true; controller.close(); };
  } }), { status: 503, headers: { "content-type": "application/json" } });
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) },
    fetch: async () => response };
  const pending = saveOwnPreference(client, "zh-CN", 1, new AbortController().signal)
    .then(() => { semanticSettled = true; return "SUCCESS"; }, error => { semanticSettled = true; return error.code; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(semanticSettled, false, "SEMANTIC_FAILURE_MUST_WAIT_FOR_BODY_EOF");
    assert.equal(response.bodyUsed, true);
  } finally { closeBody(); }
  assert.equal(await pending, "UNAVAILABLE"); assert.equal(consumed, true);
  const f = fixture(undefined, { save: () => Promise.reject(new PreferenceClientError("UNAVAILABLE")) });
  await f.sync.setActor("A"); await f.sync.save("zh-CN");
  assert.equal(f.sync.getSnapshot().status, "unavailable"); assert.equal(f.store.getSnapshot().preference, "zh-CN");
});
test("client preserves HTTP error classification when JSON is malformed or empty", async () => {
  for (const [status, code] of [[503, "UNAVAILABLE"], [409, "CONFLICT"], [401, "SIGNED_OUT"]]) {
    for (const text of ["", "not json"]) {
      const response = new Response(text, { status });
      const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async () => response };
      await assert.rejects(saveOwnPreference(client, "en", 1, new AbortController().signal), error => error.code === code);
      assert.equal(response.bodyUsed, true);
    }
  }
});
test("client successful PATCH still consumes native JSON exactly once", async () => {
  const response = Response.json({ ok: true, preference: row("en", 2) });
  const nativeJson = response.json.bind(response); let calls = 0;
  response.json = () => { calls++; return nativeJson(); };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async () => response };
  assert.deepEqual(await saveOwnPreference(client, "en", 1, new AbortController().signal), row("en", 2));
  assert.equal(response.bodyUsed, true); assert.equal(calls, 1);
});
test("client keeps AbortError safe and forwards the operation signal", async () => {
  const controller = new AbortController(); let observedSignal;
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) },
    fetch: async (_url, init) => { observedSignal = init.signal; throw new DOMException("private transport detail", "AbortError"); } };
  await assert.rejects(saveOwnPreference(client, "en", 1, controller.signal), error => error.code === "UNAVAILABLE" && !error.message.includes("private"));
  assert.equal(observedSignal, controller.signal);
  controller.abort(); observedSignal = undefined;
  await assert.rejects(saveOwnPreference(client, "en", 1, controller.signal), error => error.code === "UNAVAILABLE");
  assert.equal(observedSignal, undefined);
});
test("client body-read AbortError does not replace safe HTTP error semantics", async () => {
  for (const [status, code] of [[503, "UNAVAILABLE"], [409, "CONFLICT"], [401, "SIGNED_OUT"]]) {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.error(new DOMException("private transport detail", "AbortError"));
    } }), { status });
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async () => response };
    await assert.rejects(saveOwnPreference(client, "en", 1, new AbortController().signal), error => error.code === code && !error.message.includes("private"));
    assert.equal(response.bodyUsed, true);
  }
});
test("manual account write stays on page while pending and discards actor-switched completion", async () => {
  const d = deferred(); const f = fixture(undefined, { save: () => d.promise });
  await f.sync.setActor("A"); const navigations = f.calls.navigation;
  const pending = f.sync.save("en");
  assert.equal(f.store.getSnapshot().preference, "en"); assert.equal(f.calls.navigation, navigations);
  await f.sync.setActor("B"); d.resolve(row("zh-CN", 8)); await pending;
  assert.notEqual(f.sync.getSnapshot().account.revision, 8);
});
test("safe-route gate excludes login, recovery and callback with no URL secret inspection", () => {
  for (const pathname of ["/login/", "/register/", "/auth/callback/", "/auth/reset-password/"]) assert.equal(canAdoptOnRoute(pathname), false);
  for (const pathname of ["/settings/", "/feed/", "/support/"]) assert.equal(canAdoptOnRoute(pathname), true);
});
test("logout pending fetch never repopulates account memory", async () => {
  const d = deferred(); const f = fixture(undefined, { load: () => d.promise });
  const pending = f.sync.setActor("A"); await f.sync.setActor(null); d.resolve(row()); await pending;
  assert.equal(f.sync.getSnapshot().account, null); assert.equal(f.store.getSnapshot().preference, "auto");
});
test("malformed successful response is never account persistence success", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only", user: { id: "A" } } } }) }, fetch: async () => Response.json({ ok: true, preference: { ...row(), revision: -1 } }) };
  await assert.rejects(loadOwnPreference(client, new AbortController().signal), error => error.code === "UNAVAILABLE");
});
