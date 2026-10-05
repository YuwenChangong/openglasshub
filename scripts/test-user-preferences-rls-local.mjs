import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { assertSafeLocalReplayEnvironment, assertLocalReplayTarget, sanitizedChildEnvironment, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";
import { preferenceMigration } from "./test-user-preferences-schema.mjs";

export function preparePreferenceRunEnvironment(environment) {
  assertSafeLocalReplayEnvironment(environment);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]) {
    if (environment[name]) throw new Error("LOCAL_CREDENTIAL_ENVIRONMENT_REJECTED");
  }
  const localDockerHost = process.platform === "win32" ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
  if (environment.DOCKER_CONTEXT || (environment.DOCKER_HOST && environment.DOCKER_HOST !== localDockerHost)) throw new Error("LOCAL_DOCKER_TARGET_REJECTED");
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
  return { ...sanitizedChildEnvironment(Object.fromEntries(allowed.filter(key => environment[key]).map(key => [key, environment[key]]))), DOCKER_HOST: localDockerHost, DO_NOT_TRACK: "1" };
}

export async function runPreferenceRlsAcceptance(environment = process.env) {
  const safeEnvironment = preparePreferenceRunEnvironment(environment);
  let anonKey;
  const execute = async (command, args, options) => {
    const result = await runCommand(command, args, options);
    if (args.includes("status") && args.includes("json")) {
      const status = JSON.parse(result.stdout);
      assertLocalReplayTarget(status.API_URL);
      anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
      console.log("LOCAL_TARGET=true");
      console.log("LOOPBACK_OR_OWNED_DOCKER_NETWORK=true");
      console.log("LINKED_PROJECT=false");
      console.log("REMOTE_DATABASE_TARGET=false");
    }
    return result;
  };
  const result = await withCanonicalBaselineDirectory({ environment: safeEnvironment }, async canonicalBaselineDirectory => {
    console.log("CANONICAL_BASELINE_TEMP_SOURCE=OWNED_GIT_HEAD");
    console.log(`CANONICAL_BASELINE_FILE_COUNT=${(await readdir(canonicalBaselineDirectory)).length}`);
    return runLocalDisposableReplay({
    environment: safeEnvironment, execute, migrationLimit: 50, canonicalBaselineDirectory,
    afterMigrationLedgerValidated: async ({ target, executeSql, canonicalMigrationCount }) => {
      console.log("CANONICAL_BASELINE_REPLAY=PASS");
      assert.equal(canonicalMigrationCount, 50);
      assertLocalReplayTarget(target);
      assert.ok(typeof anonKey === "string" && anonKey.length > 0, "Owned local anon credential unavailable");
      const migration = await preferenceMigration();
      assert.equal(migration?.path, path.join(process.cwd(), "supabase/migrations/20261001075335_user_preferences.sql"), "Exact generated Task 4 candidate path required");
      // An empty pre-implementation candidate is not applied; the missing-table assertion is the RED.
      if (migration.sql.trim()) {
        assert.equal(migration.version, "20261001075335");
        await executeSql(`BEGIN;\n${migration.sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${migration.version}','user_preferences');\nCOMMIT;\nNOTIFY pgrst, 'reload schema';`);
        const ledger = await executeSql("SELECT count(*) AS additive_count FROM supabase_migrations.schema_migrations WHERE version='20261001075335' AND name='user_preferences';");
        assert.match(ledger, /\b1\b/, "Exactly one additive ledger row required");
        console.log("ADDITIVE_MIGRATION_LOCAL_APPLICATION=PASS");
      }
      const request = async (route, token, method = "GET", body) => {
        const url = new URL(route, target);
        assertLocalReplayTarget(url.href);
        assert.equal(url.origin, new URL(target).origin);
        return fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(10000), headers: { apikey: anonKey, ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", Prefer: "return=representation" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      };
      const user = async (label) => {
        const email = `local-qa-${label}-${randomBytes(6).toString("hex")}@example.invalid`;
        const password = randomBytes(24).toString("base64url");
        const signup = await request("/auth/v1/signup", null, "POST", { email, password });
        assert.equal(signup.status, 200, "Owned local Auth signup must succeed");
        const signedUp = await signup.json();
        const id = signedUp.user?.id ?? signedUp.id;
        assert.match(id ?? "", /^[0-9a-f-]{36}$/i, "Owned local user ID missing");
        if (!signedUp.session && !signedUp.access_token) await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id='${id}'::uuid;`);
        const login = await request("/auth/v1/token?grant_type=password", null, "POST", { email, password });
        assert.equal(login.status, 200, "Owned local password login must succeed");
        const session = await login.json();
        assert.ok(typeof session.access_token === "string" && session.access_token.length > 0, "Genuine local Auth JWT required");
        const check = await request("/auth/v1/user", session.access_token);
        assert.equal(check.status, 200);
        assert.equal((await check.json()).id, id);
        return { id, token: session.access_token };
      };
      const a = await user("a");
      const b = await user("b");
      const table = await executeSql("SELECT to_regclass('public.user_preferences') IS NOT NULL AS preference_table_present;");
      assert.match(table, /\bt\b/, "Missing table: user_preferences must exist before genuine RLS acceptance");
      const rest = "/rest/v1/user_preferences";
      const expectDenied = async (response) => {
        assert.ok(response.status === 401 || response.status === 403, "RLS/grant request must be denied");
        assert.equal((await response.json()).code, "42501");
      };
      await expectDenied(await request(rest, null));
      console.log("RLS_ANON_DENIED=PASS");
      await expectDenied(await request(rest, a.token, "POST", { user_id: b.id, locale_preference: "en" }));
      console.log("RLS_A_CANNOT_INSERT_B=PASS");
      for (const owner of [a,b]) {
        const insert = await request(rest, owner.token, "POST", { user_id: owner.id, locale_preference: "en" });
        assert.equal(insert.status, 201);
        const [row] = await insert.json();
        assert.equal(row.revision, 1);
        assert.equal(row.user_id, owner.id);
        assert.ok(Number.isFinite(Date.parse(row.updated_at)), "Insertion timestamp must be server generated");
      }
      const foreign = await request(`${rest}?user_id=eq.${b.id}`, a.token);
      assert.equal(foreign.status, 200); assert.deepEqual(await foreign.json(), []);
      console.log("RLS_A_CANNOT_SELECT_B=PASS");
      const updateForeign = await request(`${rest}?user_id=eq.${b.id}`, a.token, "PATCH", { locale_preference: "zh-CN" });
      assert.equal(updateForeign.status, 200); assert.deepEqual(await updateForeign.json(), []);
      const checkB = await request(rest, b.token);
      assert.equal((await checkB.json())[0].locale_preference, "en");
      console.log("RLS_A_CANNOT_UPDATE_B=PASS");
      for (const payload of [{ user_id: b.id }, { revision: 99 }, { updated_at: "2000-01-01T00:00:00Z" }]) await expectDenied(await request(`${rest}?user_id=eq.${a.id}`, a.token, "PATCH", payload));
      await expectDenied(await request(`${rest}?user_id=eq.${a.id}`, a.token, "DELETE"));
      const own = await request(`${rest}?user_id=eq.${a.id}&revision=eq.1`, a.token, "PATCH", { locale_preference: "zh-CN" });
      assert.equal(own.status, 200);
      const ownRow = (await own.json())[0];
      assert.equal(ownRow.revision, 2);
      const stale = await request(`${rest}?user_id=eq.${a.id}&revision=eq.1`, a.token, "PATCH", { locale_preference: "en" });
      assert.equal(stale.status, 200); assert.deepEqual(await stale.json(), []);
      const same = await request(`${rest}?user_id=eq.${a.id}&revision=eq.2`, a.token, "PATCH", { locale_preference: "zh-CN" });
      assert.equal(same.status, 200);
      const sameRow = (await same.json())[0];
      assert.equal(sameRow.revision, 3, "Every accepted update must advance revision, including the same locale");
      assert.ok(Date.parse(sameRow.updated_at) > Date.parse(ownRow.updated_at), "Update timestamp must advance on the server");
      console.log("RLS_METADATA_AND_OWNER_REASSIGNMENT_DENIED=PASS");
      console.log("LOCAL_REAL_AUTH_A_B_ANON=PASS");
      return { status: "PASS", actors: "REAL_LOCAL_AUTH_A_B_ANON" };
    },
    });
  });
  assert.equal(result.afterMigrationLedgerValidated.status, "PASS");
  console.log("LOCAL_OWNED_RUNTIME_CLEANUP=PASS");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runPreferenceRlsAcceptance(); }
  catch (error) {
    const assertions = [
      "Owned local anon credential unavailable", "Exact generated Task 4 candidate path required",
      "Owned local Auth signup must succeed", "Owned local user ID missing",
      "Owned local password login must succeed", "Genuine local Auth JWT required",
      "Missing table: user_preferences must exist before genuine RLS acceptance",
      "Exactly one additive ledger row required", "RLS/grant request must be denied",
      "Every accepted update must advance revision, including the same locale",
      "Update timestamp must advance on the server", "Insertion timestamp must be server generated",
    ];
    const safeAssertion = assertions.find(message => error.message?.startsWith(message));
    console.error(`LOCAL_PREFERENCE_RLS=BLOCKED ${safeAssertion ?? error.startDiagnostic ?? error.code ?? "UNCLASSIFIED_LOCAL_FAILURE"}`);
    process.exitCode = 1;
  }
}
