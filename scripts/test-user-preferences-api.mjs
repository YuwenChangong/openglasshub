import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { handlePreferenceRequest } from "../src/lib/server/user-preferences.server.ts";

const actor = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const env = { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "test-anon" };
const initial = () => ({ user_id: actor, locale_preference: "en", revision: 1, updated_at: "2026-10-01T00:00:00Z" });

function fixture({ row = null, dbError = null, authError = false } = {}) {
  const calls = [];
  let current = row;
  const client = {
    auth: { getUser: async token => { calls.push(["getUser", token]); return { data: { user: authError ? null : { id: actor } }, error: authError ? {} : null }; } },
    from(table) {
      calls.push(["from", table]);
      assert.equal(table, "user_preferences");
      let operation = "read", payload, projection;
      const filters = new Map();
      const query = {
        select(fields) { projection = fields; return query; },
        insert(value) { operation = "insert"; payload = value; return query; },
        update(value) { operation = "update"; payload = value; return query; },
        eq(key, value) { filters.set(key, value); return query; },
        async maybeSingle() {
          calls.push([operation, payload, Object.fromEntries(filters), projection]);
          assert.equal(projection, "locale_preference,revision,updated_at");
          if (dbError) return { error: { code: dbError, message: "DO_NOT_EXPOSE_PROVIDER_TEXT" }, data: null };
          if (operation === "insert") {
            assert.deepEqual(Object.keys(payload).sort(), ["locale_preference", "user_id"]);
            assert.equal(payload.user_id, actor);
            if (current) return { error: { code: "23505" }, data: null };
            current = { ...initial(), locale_preference: payload.locale_preference };
          } else {
            assert.equal(filters.get("user_id"), actor);
            if (operation === "update") {
              assert.deepEqual(Object.keys(payload), ["locale_preference"]);
              if (!current || current.revision !== filters.get("revision")) return { data: null, error: null };
              current = { ...current, locale_preference: payload.locale_preference, revision: current.revision + 1 };
            }
          }
          return { data: current ? { ...current, user_id: actor, role: "DO_NOT_EXPOSE" } : null, error: null };
        },
        single() { return query.maybeSingle(); },
      };
      return query;
    },
  };
  const dependencies = { createClient(url, key, options) {
    calls.push(["createClient"]);
    assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_ANON_KEY);
    assert.deepEqual(options.global.headers, { Authorization: "Bearer unit-test-token" });
    assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false);
    return client;
  } };
  return { calls, dependencies, row: () => current };
}

function request(method = "GET", body, headers = {}) {
  return new Request("https://app.example.test/api/users/me/preferences", { method,
    headers: { authorization: "Bearer unit-test-token", ...(method === "PATCH" ? { "content-type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}

async function checked(req, f, expected) {
  const response = await handlePreferenceRequest(req, env, f.dependencies);
  assert.equal(response.status, expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /DO_NOT_EXPOSE|user_id|unit-test-token/);
  return JSON.parse(text);
}

test("no bearer means unauthorized before client creation, regardless of cookie or country", async () => {
  const f = fixture();
  const req = request("GET", undefined, { authorization: "", cookie: "ogh_preferences_v1=en", "cf-ipcountry": "CN" });
  assert.deepEqual(await checked(req, f, 401), { ok: false, code: "UNAUTHORIZED" });
  assert.deepEqual(f.calls, []);
});

test("invalid bearer is rejected without reading preference data", async () => {
  const f = fixture({ authError: true });
  await checked(request(), f, 401);
  assert.equal(f.calls.some(([name]) => name === "from"), false);
});

test("absent GET returns defaults without creating a row", async () => {
  const f = fixture();
  assert.deepEqual(await checked(request(), f, 200), { ok: true, preference: { locale_preference: "auto", revision: 0, updated_at: null } });
  assert.equal(f.row(), null);
});

test("GET projects only the actor preference, not identifiers or role", async () => {
  const f = fixture({ row: initial() });
  assert.deepEqual((await checked(request(), f, 200)).preference, { locale_preference: "en", revision: 1, updated_at: initial().updated_at });
});

for (const payload of [null, [], {}, "{", { locale_preference: "xx", expected_revision: 1 },
  { locale_preference: "en", expected_revision: -1 }, { locale_preference: "en", expected_revision: 1.5 },
  ...["user_id", "country", "theme", "revision", "updated_at"].map(key => ({ locale_preference: "en", expected_revision: 1, [key]: other }))]) {
  test(`reject strict PATCH input ${JSON.stringify(payload)}`, async () => {
    const f = fixture({ row: initial() });
    await checked(request("PATCH", payload === null ? "null" : payload), f, 400);
    assert.deepEqual(f.row(), initial());
    assert.equal(f.calls.some(([name]) => name === "from"), false);
  });
}

test("bounded byte body and JSON media type, no cross-origin mutation", async () => {
  for (const [req, status] of [
    [request("PATCH", "x".repeat(1025)), 413],
    [request("PATCH", "中".repeat(400)), 413],
    [request("PATCH", {}, { "content-type": "text/plain" }), 400],
    [request("PATCH", {}, { origin: "https://foreign.example.test" }), 400],
    [request("PATCH", {}, { "sec-fetch-site": "cross-site" }), 400],
  ]) {
    const f = fixture(); await checked(req, f, status);
    assert.equal(f.calls.some(([name]) => name === "from"), false);
  }
});

test("revision zero inserts the verified owner with server metadata", async () => {
  const f = fixture();
  const result = await checked(request("PATCH", { locale_preference: "zh-CN", expected_revision: 0 }), f, 200);
  assert.equal(result.preference.revision, 1); assert.equal(f.row().user_id, actor);
});

test("duplicate insert and stale update return conflict without overwriting", async () => {
  for (const revision of [0, 2]) {
    const f = fixture({ row: initial() });
    assert.deepEqual(await checked(request("PATCH", { locale_preference: "zh-CN", expected_revision: revision }), f, 409), { ok: false, code: "PREFERENCES_CONFLICT" });
    assert.deepEqual(f.row(), initial());
  }
});

test("two updates with the same revision yield exactly one success", async () => {
  const f = fixture({ row: initial() });
  const responses = await Promise.all(["zh-CN", "auto"].map(locale_preference => handlePreferenceRequest(request("PATCH", { locale_preference, expected_revision: 1 }), env, f.dependencies)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.row().revision, 2);
});

test("database failures and invalid projection fail closed without provider text", async () => {
  for (const options of [{ dbError: "08006" }, { row: { ...initial(), revision: 0 } }, { row: { ...initial(), updated_at: "invalid" } }]) {
    const f = fixture(options);
    assert.deepEqual(await checked(request(), f, 503), { ok: false, code: "PREFERENCES_UNAVAILABLE" });
  }
});

test("preferences do not call consent, rate-limit elevation or service-role helpers", async () => {
  const source = await readFile(new URL("../src/lib/server/user-preferences.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY|consumeForumRateLimit|requireAuthenticatedLegalConsent|upsert/);
});
