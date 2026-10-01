import assert from "node:assert/strict";
import { test } from "node:test";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { assertLocalReplayTarget, assertOwnedDisposableRoot } from "./qa/local-disposable-supabase-replay.mjs";
import os from "node:os";
import path from "node:path";

test("local env discards provider credentials and uses only local Docker", () => {
  const env = preparePreferenceRunEnvironment({ PATH: "fixture", CLOUDFLARE_API_TOKEN: "synthetic", HOME: "fixture" });
  assert.equal(env.PATH, "fixture");
  assert.equal("CLOUDFLARE_API_TOKEN" in env, false);
  assert.equal(env.DOCKER_HOST, "npipe:////./pipe/docker_engine");
});
for (const fixture of [
  { P9_PRODUCTION_DATABASE_URL: "postgresql://example.invalid/database" },
  { DATABASE_URL: "postgresql://example.invalid/database" },
  { SUPABASE_URL: "https://example.invalid" },
  { SUPABASE_PROJECT_REF: "synthetic" },
  { SUPABASE_SERVICE_ROLE_KEY: "synthetic" },
  { DOCKER_HOST: "tcp://example.invalid:2375" },
]) test(`reject nonlocal execution input ${Object.keys(fixture)[0]}`, () => assert.throws(() => preparePreferenceRunEnvironment(fixture), /Refusing|LOCAL_/));
test("isolated execution child has no approved remote selectors and passes existing guards", () => {
  for (const name of ["P9_PRODUCTION_DATABASE_URL", "POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE", "SUPABASE_DB_URL", "SUPABASE_URL", "PUBLIC_SUPABASE_URL", "SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]) {
    assert.equal(Object.hasOwn(process.env, name), false, `${name} must be absent before test execution`);
  }
  const env = preparePreferenceRunEnvironment(process.env);
  assert.equal(env.DOCKER_HOST, "npipe:////./pipe/docker_engine");
  assert.equal(assertLocalReplayTarget("http://127.0.0.1:54321"), true);
});
test("only loopback API may be accessed", () => {
  assert.equal(assertLocalReplayTarget("http://127.0.0.1:54321"), true);
  assert.throws(() => assertLocalReplayTarget("https://example.invalid"), /non-local/);
});
test("disposable root cannot be repository or the whole temp directory", () => {
  assert.throws(() => assertOwnedDisposableRoot({ disposableRoot: process.cwd(), repositoryRoot: process.cwd() }));
  assert.throws(() => assertOwnedDisposableRoot({ disposableRoot: os.tmpdir(), repositoryRoot: process.cwd() }));
});
