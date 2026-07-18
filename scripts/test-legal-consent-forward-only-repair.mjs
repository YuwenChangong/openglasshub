import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const image = "public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const proposalPath = "/repo/docs/ops/reconciliation/legal-consent-forward-only-repair-v1.sql";
const proposal = await readFile("docs/ops/reconciliation/legal-consent-forward-only-repair-v1.sql", "utf8");
const preflight = await readFile("docs/ops/reconciliation/legal-consent-forward-only-preflight-v1.sql", "utf8");
const postflight = await readFile("docs/ops/reconciliation/legal-consent-forward-only-postflight-v1.sql", "utf8");
const canonical = await readFile("supabase/migrations/20260712_legal_policy_acceptances.sql");
const canonicalHash = createHash("sha256").update(canonical).digest("hex");

for (const forbidden of [/create\s+table\s+if\s+not\s+exists/i, /create\s+or\s+replace/i, /drop\s+/i]) assert.doesNotMatch(proposal, forbidden);
assert.match(proposal, /^BEGIN;/m); assert.match(proposal, /COMMIT;\s*$/); assert.match(proposal, /migration-ledger precondition failed/); assert.match(proposal, /updated_at helper is missing or divergent/);
assert.match(preflight, /SAFE_TO_CREATE_EXACTLY/); assert.match(postflight, /LEGAL_CONSENT_CATALOG_EXACT/);
assert.equal(canonicalHash, "839d5394aabdd0301ea2c98f58799e66ec1abedd7c8cff9e4c8f55c1b06d33df");

const name = `legal-consent-${randomUUID().slice(0, 12)}`;
const database = "legal_consent_forward_only";
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", ...options });
const exec = (args, input = "", allowFailure = false) => {
  const result = docker(["exec", "-i", name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, ...args], { input });
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
};
const scalar = (sql) => exec(["-tA", "-c", sql]).stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
const apply = (text = null) => text === null
  ? docker(["exec", name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-f", proposalPath])
  : exec([], text, true);

const base = (helper = "exact") => `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth AUTHORIZATION postgres;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
CREATE SCHEMA supabase_migrations AUTHORIZATION postgres;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text NOT NULL);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
${helper === "missing" ? "" : `CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ begin ${helper === "exact" ? "new.updated_at = now();" : "new.updated_at = clock_timestamp();"} return new; end; $$;`}
`;

const start = docker(["run", "-d", "--rm", "--name", name, "--mount", `type=bind,src=${root},dst=/repo,readonly`, "-e", "POSTGRES_PASSWORD=localtest", image]);
assert.equal(start.status, 0, start.stderr || start.stdout);
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    if (attempt === 39) throw new Error("local postgres did not become ready");
  }
  // Supabase's image briefly exposes a bootstrap server before its final server.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  assert.equal(docker(["exec", name, "createdb", "-U", "postgres", database]).status, 0, "local disposable database must be created");

  exec([], base());
  assert.equal(scalar("SELECT md5(regexp_replace(btrim(prosrc), '[[:space:]]+', ' ', 'g')) FROM pg_proc WHERE oid=to_regprocedure('public.set_updated_at()')"), "077bb7aa35a4fed76f447b242607c205", "local helper must match the reviewed canonical body");
  assert.equal(scalar("SELECT pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='v' AND proparallel='u' AND coalesce(cardinality(proconfig),0)=0 FROM pg_proc WHERE oid=to_regprocedure('public.set_updated_at()')"), "t", "local helper metadata must match");
  assert.match(scalar(`SELECT (packet->>'classification') FROM (${preflight.replace(/;\s*$/, "")}) q(packet)`), /SAFE_TO_CREATE_EXACTLY/);
  { const result = apply(); assert.equal(result.status, 0, `clean local apply must commit: ${result.stderr || result.stdout}`); }
  assert.match(scalar(`SELECT (packet->>'classification') FROM (${postflight.replace(/;\s*$/, "")}) q(packet)`), /LEGAL_CONSENT_CATALOG_EXACT/);
  assert.equal(scalar("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260712'"), "0");

  const userA = "00000000-0000-0000-0000-000000000901";
  const userB = "00000000-0000-0000-0000-000000000902";
  exec([], `INSERT INTO auth.users VALUES ('${userA}'), ('${userB}'); SET ROLE service_role; SELECT public.record_current_legal_policy_acceptance('${userA}','2026-07','2026-07','2026-07','2026-07',16::smallint,'login'); RESET ROLE;`);
  assert.equal(scalar(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${userA}',false); SELECT count(*) FROM public.legal_policy_acceptances;`), "1");
  assert.equal(scalar(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${userB}',false); SELECT count(*) FROM public.legal_policy_acceptances;`), "0");
  assert.notEqual(exec([], `SET ROLE authenticated; INSERT INTO public.legal_policy_acceptances (user_id,bundle_version,terms_version,privacy_version,guidelines_version,minimum_age,first_acceptance_source,last_confirmation_source) VALUES ('${userA}','x','x','x','x',16,'login','login');`, true).status, 0);
  assert.notEqual(exec([], `SET ROLE authenticated; SELECT public.record_current_legal_policy_acceptance('${userA}','x','x','x','x',16,'login');`, true).status, 0);
  exec([], `SET ROLE service_role; SELECT public.record_current_legal_policy_acceptance('${userA}','2026-07','2026-07','2026-07','2026-07',16::smallint,'login'); RESET ROLE;`);
  assert.equal(scalar(`SELECT confirmation_count FROM public.legal_policy_acceptances WHERE user_id='${userA}' AND bundle_version='2026-07'`), "2");

  for (const [label, setup] of [["table", "CREATE TABLE public.legal_policy_acceptances (id uuid);"], ["rpc", "CREATE FUNCTION public.record_current_legal_policy_acceptance() RETURNS void LANGUAGE sql AS $$ SELECT $$;"], ["helper-missing", ""], ["helper-divergent", ""]]) {
    exec([], base(label === "helper-missing" ? "missing" : label === "helper-divergent" ? "divergent" : "exact"));
    if (setup) exec([], setup);
    if (label === "helper-divergent") {
      assert.match(scalar(`SELECT (packet->>'classification') FROM (${preflight.replace(/;\s*$/, "")}) q(packet)`), /BLOCKED_DEPENDENCY/);
      continue;
    }
    const result = apply(); assert.notEqual(result.status, 0, `${label} must fail closed`);
    if (label === "helper-missing" || label === "helper-divergent") assert.equal(scalar("SELECT to_regclass('public.legal_policy_acceptances') IS NULL"), "t");
  }
  exec([], base());
  const injected = proposal.replace("CREATE INDEX legal_policy_acceptances_bundle_last_confirmed_idx", "SELECT 1/0;\nCREATE INDEX legal_policy_acceptances_bundle_last_confirmed_idx");
  assert.notEqual(apply(injected).status, 0, "injected mid-transaction failure must abort");
  assert.equal(scalar("SELECT to_regclass('public.legal_policy_acceptances') IS NULL"), "t");
  exec([], base()); assert.equal(apply().status, 0); assert.notEqual(apply().status, 0, "re-execution must fail closed");
  console.log(JSON.stringify({ status: "PASS", localOnly: true, cleanApply: true, failureCases: 6, rlsAcl: true, rpcIdempotency: true, migrationLedgerUnchanged: true, canonicalMigrationUnchanged: true }));
} finally { docker(["rm", "-f", name]); }
