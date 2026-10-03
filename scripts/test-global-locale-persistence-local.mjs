import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { JSDOM } from "jsdom";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { preferenceMigration } from "./test-user-preferences-schema.mjs";
import { assertLocalReplayTarget, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";
import { handlePreferenceRequest } from "../src/lib/server/user-preferences.server.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { createLocaleStore } from "../src/lib/i18n/locale-store.ts";
import { createPreferenceSync } from "../src/lib/i18n/preference-sync.ts";
import { loadOwnPreference, saveOwnPreference } from "../src/lib/i18n/preference-client.ts";
import { readBrowserPreference, writeBrowserPreference, serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";

let stage = "LOCAL_ENVIRONMENT_GUARD";
let remoteAttempts = 0;
const originalFetch = globalThis.fetch;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const allowedOrigins = new Set();
let server, dom;
const synchronizers = [];

function verify(value, name) {
  stage = name;
  assert.ok(value, name);
  console.log(`${name}=PASS`);
}

try {
  assert.equal(process.argv.length, 2, "No caller-selected target or remote options allowed");
  const environment = preparePreferenceRunEnvironment(process.env);
  let anonKey;
  const execute = async (command, args, options) => {
    const result = await runCommand(command, args, options);
    if (args.includes("status") && args.includes("json")) {
      const status = JSON.parse(result.stdout);
      assertLocalReplayTarget(status.API_URL);
      const url = new URL(status.API_URL);
      assert.ok(url.protocol === "http:" && !url.username && !url.password);
      allowedOrigins.add(url.origin);
      anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
    }
    return result;
  };
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    try { assertLocalReplayTarget(url.href); }
    catch { remoteAttempts++; throw new Error("REMOTE_TARGET_REJECTED"); }
    assert.ok(allowedOrigins.has(url.origin), "Only this run's owned origins are allowed");
    assert.ok(!url.username && !url.password);
    return originalFetch(input, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(10000) });
  };

  stage = "DISPOSABLE_LOCAL_SUPABASE_STARTUP";
  const result = await withCanonicalBaselineDirectory({ environment }, canonicalBaselineDirectory => runLocalDisposableReplay({
    environment, execute, canonicalBaselineDirectory, migrationLimit: 50,
    afterMigrationLedgerValidated: async ({ target, executeSql, canonicalMigrationCount }) => {
      stage = "LOCAL_SCHEMA_SETUP";
      assertLocalReplayTarget(target);
      assert.equal(canonicalMigrationCount, 50);
      assert.ok(typeof anonKey === "string" && anonKey.length > 0);
      console.log("LOCAL_SUPABASE_STARTED=true LOCAL_SUPABASE_TARGET=LOOPBACK PRODUCTION_ENV_USED=false");
      const migration = await preferenceMigration();
      assert.equal(migration?.path, path.join(process.cwd(), "supabase/migrations/20261001075335_user_preferences.sql"));
      assert.equal(migration.version, "20261001075335");
      assert.ok(migration.sql.trim());
      await executeSql(`BEGIN;\n${migration.sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${migration.version}','user_preferences');\nCOMMIT;\nNOTIFY pgrst, 'reload schema';`);
      const ledger = await executeSql("SELECT count(*) AS additive_count FROM supabase_migrations.schema_migrations WHERE version='20261001075335' AND name='user_preferences';");
      verify(/\b1\b/.test(ledger), "EXACT_LOCAL_ADDITIVE_MIGRATION");

      const client = () => createClient(target, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const createActor = async label => {
        stage = `GENUINE_LOCAL_AUTH_${label}`;
        const email = `local-persistence-${label.toLowerCase()}-${randomBytes(6).toString("hex")}@example.invalid`;
        const password = randomBytes(24).toString("base64url");
        const auth = client();
        const signup = await auth.auth.signUp({ email, password });
        assert.equal(signup.error, null);
        const id = signup.data.user?.id;
        assert.match(id ?? "", /^[0-9a-f-]{36}$/i);
        if (!signup.data.session) await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id='${id}'::uuid;`);
        const login = async () => {
          const current = client();
          const signedIn = await current.auth.signInWithPassword({ email, password });
          assert.equal(signedIn.error, null);
          assert.equal(signedIn.data.user?.id, id);
          assert.ok(signedIn.data.session?.access_token);
          const check = await current.auth.getUser();
          assert.equal(check.error, null);
          assert.equal(check.data.user?.id, id);
          return current;
        };
        return { id, client: await login(), login };
      };
      const a = await createActor("A"), b = await createActor("B");
      verify(a.id !== b.id, "GENUINE_LOCAL_AUTH_A_B");

      // A loopback HTTP adapter exercises the unchanged product API handler and
      // its genuine Supabase client, without starting or rerunning browser cases.
      let origin;
      stage = "OWNED_LOCAL_PREFERENCE_HTTP_STARTUP";
      server = createServer(async (incoming, outgoing) => {
        try {
          assert.equal(incoming.url, "/api/users/me/preferences");
          const chunks = [];
          let size = 0;
          for await (const chunk of incoming) { size += chunk.length; assert.ok(size <= 1024); chunks.push(chunk); }
          const request = new Request(origin + incoming.url, {
            method: incoming.method, headers: incoming.headers,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          });
          const response = await handlePreferenceRequest(request, { SUPABASE_URL: target, SUPABASE_ANON_KEY: anonKey });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch { outgoing.writeHead(500); outgoing.end('{"ok":false}'); }
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      allowedOrigins.add(origin);
      const ownClient = actor => ({
        auth: actor.client.auth, actor: actor.id,
        fetch: (route, init) => {
          assert.equal(route, "/api/users/me/preferences");
          return fetch(origin + route, init);
        },
      });
      const load = actor => loadOwnPreference(ownClient(actor), new AbortController().signal);
      const save = (actor, preference, revision) => saveOwnPreference(ownClient(actor), preference, revision, new AbortController().signal);
      const anonymous = client();
      const anonRow = await anonymous.from("user_preferences").select("locale_preference");
      verify(anonRow.error?.code === "42501", "REAL_RLS_ANON_DENIED");
      const anonResponse = await fetch(origin + "/api/users/me/preferences");
      await anonResponse.arrayBuffer();
      verify(anonResponse.status === 401, "ANONYMOUS_ACCOUNT_API_DENIED");

      stage = "REAL_ACCOUNT_INITIAL_ROWS";
      assert.equal((await load(a)).revision, 0);
      assert.equal((await load(b)).revision, 0);
      const rowA = await save(a, "en", 0), rowB = await save(b, "zh-CN", 0);
      verify(rowA.revision > 0 && rowB.revision > 0, "REAL_ACCOUNT_ROWS_CREATED");
      const foreignRead = await b.client.from("user_preferences").select("locale_preference").eq("user_id", a.id);
      verify(foreignRead.error === null && foreignRead.data.length === 0, "REAL_RLS_B_CANNOT_READ_A");
      const foreignWrite = await b.client.from("user_preferences").update({ locale_preference: "auto" }).eq("user_id", a.id).select("locale_preference");
      verify(foreignWrite.error === null && foreignWrite.data.length === 0, "REAL_RLS_B_CANNOT_UPDATE_A");
      const foreignInsert = await a.client.from("user_preferences").insert({ user_id: b.id, locale_preference: "auto" });
      verify(foreignInsert.error?.code === "42501", "REAL_RLS_A_CANNOT_INSERT_B");

      dom = new JSDOM("", { url: "https://127.0.0.1/settings/" });
      globalThis.document = dom.window.document;
      const reconstruct = () => {
        const store = createLocaleStore(resolveLocale({ saved: readBrowserPreference(), trustedCountry: "CN", acceptLanguage: "en" }), {
          writePreference: writeBrowserPreference, readPreference: readBrowserPreference, navigate() {},
        });
        return store;
      };
      const synchronize = (store, actor) => {
        const sync = createPreferenceSync(store, {
          load: (id, signal) => { assert.equal(id, actor.id); return loadOwnPreference(ownClient(actor), signal); },
          save: (id, preference, revision, signal) => { assert.equal(id, actor.id); return saveOwnPreference(ownClient(actor), preference, revision, signal); },
        });
        synchronizers.push(sync);
        return sync;
      };
      const snapshotIs = (store, locale, provenance) => {
        const snapshot = store.getSnapshot();
        return snapshot.locale === locale && snapshot.preference === locale && snapshot.provenance === provenance;
      };

      stage = "ANONYMOUS_DEVICE_COOKIE_PERSISTENCE";
      const device = reconstruct();
      assert.equal(device.getSnapshot().locale, "zh-CN");
      assert.equal(readBrowserPreference(), undefined);
      assert.equal(device.select("en"), true);
      verify(snapshotIs(reconstruct(), "en", "device_explicit"), "ANONYMOUS_COOKIE_RELOAD_AND_NAVIGATION");
      const record = readBrowserPreference();
      assert.deepEqual(Object.keys(record).sort(), ["generation", "preference", "provenance", "version"]);
      assert.match(serializePreferenceCookie(record), /; Path=\/; Secure; SameSite=Lax; Max-Age=15552000$/);
      assert.deepEqual(await load(a), rowA);
      assert.deepEqual(await load(b), rowB);
      verify(true, "DEVICE_STATE_DOES_NOT_WRITE_ACCOUNT_COUNTRY_OR_IP");

      document.cookie = "ogh_preferences_v1=; Path=/; Secure; Max-Age=0";
      stage = "ACCOUNT_ADOPTION_PERSISTENCE";
      const adopted = reconstruct(), adoptedSync = synchronize(adopted, a);
      await adoptedSync.setActor(a.id);
      verify(snapshotIs(adopted, "en", "account_adopted"), "ACCOUNT_A_ROW_ADOPTED_AFTER_LOGIN");
      assert.deepEqual(await load(a), rowA, "Inferred adoption must never upload a preference");
      const beforeSelection = reconstruct(), reloadSync = synchronize(beforeSelection, a);
      await reloadSync.setActor(a.id);
      verify(snapshotIs(beforeSelection, "en", "account_adopted") && beforeSelection.getSnapshot().source === "saved", "PRE_SELECTION_RELOAD_ACCOUNT_ADOPTED");
      stage = "EXPLICIT_ACCOUNT_SAVE";
      await reloadSync.save("zh-CN");
      assert.equal(reloadSync.getSnapshot().status, "saved");
      const savedA = await load(a);
      assert.equal(savedA.locale_preference, "zh-CN");
      assert.equal(savedA.revision, rowA.revision + 1);
      assert.ok(Date.parse(savedA.updated_at) > Date.parse(rowA.updated_at));
      verify(snapshotIs(reconstruct(), "zh-CN", "device_explicit"), "POST_SELECTION_COOKIE_AND_ACCOUNT_ROW_RELOAD");

      stage = "GENUINE_LOGOUT_AND_REAUTH_PERSISTENCE";
      const logout = await a.client.auth.signOut();
      assert.equal(logout.error, null);
      await reloadSync.setActor(null);
      verify(snapshotIs(reconstruct(), "zh-CN", "device_explicit"), "POST_LOGOUT_DEVICE_EXPLICIT_RETAINED");
      a.client = await a.login();
      assert.deepEqual(await load(a), savedA);
      verify(true, "ACCOUNT_ROW_PERSISTS_AFTER_GENUINE_REAUTHENTICATION");

      stage = "ACCOUNT_SWITCH_PERSISTENCE";
      // Use genuine row values, not browser-harness shadow revisions.
      const switched = reconstruct(), switchSync = synchronize(switched, b);
      await switchSync.setActor(b.id);
      assert.deepEqual(switchSync.getSnapshot().account, rowB);
      assert.deepEqual(await load(b), rowB);
      verify(snapshotIs(switched, "zh-CN", "device_explicit"), "ACCOUNT_B_OWN_ROW_DEVICE_CHOICE_PRESERVED");
      stage = "GENUINE_REVISION_CONFLICT";
      await assert.rejects(save(a, "en", rowA.revision), error => error.code === "CONFLICT");
      assert.deepEqual(await load(a), savedA);
      assert.deepEqual(await load(b), rowB);
      verify(true, "STALE_REVISION_REJECTED_WITH_ROWS_UNCHANGED");
      return { status: "PASS" };
    },
  }));
  stage = "OWNED_RUNTIME_CLEANUP";
  assert.equal(result.afterMigrationLedgerValidated.status, "PASS");
  assert.equal(result.remoteConnections, 0);
  assert.equal(remoteAttempts, 0);
  console.log("GENUINE_LOCAL_AUTH_USED=true FAKE_JWT_USED=false SERVICE_ROLE_USED_AS_USER_ACTOR=false REAL_LOCAL_RLS_USED=true");
} catch (error) {
  process.exitCode = 1;
  console.error(`GLOBAL_LOCALE_PERSISTENCE=BLOCKED FIRST_FAIL=${stage} FAILURE_CLASS=${error?.code === "ERR_ASSERTION" ? "ASSERTION_FAILED" : "LOCAL_RUNNER_FAILURE"}`);
} finally {
  for (const sync of synchronizers) sync.dispose();
  try {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } catch { process.exitCode = 1; console.error("GLOBAL_LOCALE_PERSISTENCE=BLOCKED FIRST_FAIL=LOCAL_HTTP_CLEANUP"); }
  dom?.window.close();
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  globalThis.fetch = originalFetch;
}
if (!process.exitCode) {
  console.log("LOCAL_OWNED_RUNTIME_CLEANUP=PASS REMOTE_SUPABASE_REFERENCE_COUNT=0");
  console.log("GLOBAL_LOCALE_PERSISTENCE=PASS TASK19_LOCAL_PERSISTENCE_ACCEPTANCE=PASS");
}
