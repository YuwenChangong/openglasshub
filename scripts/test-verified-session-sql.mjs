import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildLocalSupabaseReplayMirror, ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = path.join(root, "supabase/migrations/20260923000000_ogh_verified_session_v1.sql");
const cli = path.join(root, "node_modules/supabase/dist/supabase.js");
const id = randomUUID().replaceAll("-", "").slice(0, 8);
const projectId = `ogh-verified-sql-${id}`;
const expectedTables = ["ogh_email_send_budget", "ogh_login_challenges", "ogh_policy_acceptances", "ogh_verified_sessions"];
const expectedColumns = {
  ogh_verified_sessions: [
    ["session_id", "uuid", false, null], ["user_id", "uuid", false, null],
    ["verified_at", "timestamp with time zone", false, "now()"], ["verification_kind", "text", false, null],
    ["revoked_at", "timestamp with time zone", true, null],
  ],
  ogh_login_challenges: [
    ["id", "uuid", false, null], ["user_id", "uuid", false, null], ["session_id", "uuid", false, null],
    ["code_digest", "bytea", false, null], ["created_at", "timestamp with time zone", false, "now()"],
    ["expires_at", "timestamp with time zone", false, null], ["attempts", "smallint", false, "0"],
    ["send_count", "smallint", false, "0"], ["next_send_at", "timestamp with time zone", false, null],
    ["delivery_state", "text", false, null], ["consumed_at", "timestamp with time zone", true, null],
    ["superseded_at", "timestamp with time zone", true, null],
  ],
  ogh_email_send_budget: [
    ["utc_day", "date", false, null], ["scope", "text", false, null], ["scope_key", "text", false, null],
    ["send_count", "integer", false, "0"], ["updated_at", "timestamp with time zone", false, "now()"],
  ],
  ogh_policy_acceptances: [
    ["user_id", "uuid", false, null], ["bundle_version", "text", false, null],
    ["terms_version", "text", false, null], ["privacy_version", "text", false, null],
    ["guidelines_version", "text", false, null], ["acceptance_source", "text", false, null],
    ["accepted_at", "timestamp with time zone", false, "now()"],
  ],
};
const expectedConstraints = {
  ogh_verified_sessions: [/PRIMARY KEY \(session_id\)/, /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/, /verification_kind.*signup.*login_challenge/, /revoked_at IS NULL.*revoked_at >= verified_at/],
  ogh_login_challenges: [/PRIMARY KEY \(id\)/, /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/, /octet_length\(code_digest\) = 32/, /expires_at > created_at/, /attempts >= 0.*attempts <= 5/, /send_count >= 0.*send_count <= 3/, /delivery_state.*reserved.*accepted.*unusable/],
  ogh_email_send_budget: [/PRIMARY KEY \(utc_day, scope, scope_key\)/, /scope.*global.*user.*session.*ip_hash/, /length\(scope_key\).*1.*128/, /send_count >= 0/],
  ogh_policy_acceptances: [/PRIMARY KEY \(user_id, bundle_version\)/, /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/, /acceptance_source.*registration.*login.*policy_update.*legacy_account_gate.*authenticated_callback/, /bundle_version.*[<>]/, /terms_version.*[<>]/, /privacy_version.*[<>]/, /guidelines_version.*[<>]/],
};
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function cleanEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|comspec|pathext|appdata|localappdata|userprofile)$/i.test(key)));
  return { ...env, SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "", SUPABASE_DB_URL: "" };
}
function run(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: cleanEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${path.basename(exe)} ${args[1] ?? args[0]} exited ${code}: ${output.slice(-3000)}`)));
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function query(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function expectDenied(client, role, sql) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(client.query(sql), (error) => error.code === "42501");
    checks++;
  } finally { await client.query("ROLLBACK"); }
}
async function predicate(client, { role = "authenticated", user, session, anonymous = false } = {}, manageTransaction = true) {
  if (manageTransaction) await client.query("BEGIN");
  try {
    if (role !== "anon") await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, session_id: session, role, is_anonymous: anonymous })]);
    return (await query(client, "SELECT public.ogh_is_verified_session() AS value"))[0].value;
  } finally { if (manageTransaction) await client.query("ROLLBACK"); }
}
async function verify(client) {
  const tables = (await query(client, "SELECT tablename FROM pg_tables WHERE schemaname='private' ORDER BY tablename")).map((row) => row.tablename);
  assert.deepEqual(tables, expectedTables); checks++;
  for (const table of expectedTables) {
    const owner = await query(client, "SELECT tableowner FROM pg_tables WHERE schemaname='private' AND tablename=$1", [table]);
    check(owner[0].tableowner === "postgres", `${table} owner`);
    const columns = await query(client, "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='private' AND table_name=$1 ORDER BY ordinal_position", [table]);
    assert.deepEqual(columns.map((c) => [c.column_name, c.data_type, c.is_nullable === "YES", c.column_default]), expectedColumns[table], `${table} columns`); checks++;
    const definitions = (await query(client, "SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' AND r.relname=$1", [table])).map((r) => r.definition);
    for (const pattern of expectedConstraints[table]) check(definitions.some((value) => pattern.test(value)), `${table} constraint ${pattern}`);
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const [{ allowed }] = await query(client, "SELECT has_table_privilege($1, $2, $3) AS allowed", [role, `private.${table}`, privilege]);
        check(!allowed, `${role} ${privilege} ${table}`);
      }
      await expectDenied(client, role, `SELECT * FROM private.${table}`);
      await expectDenied(client, role, `INSERT INTO private.${table} DEFAULT VALUES`);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    const [{ allowed }] = await query(client, "SELECT has_schema_privilege($1, 'private', 'USAGE') AS allowed", [role]);
    check(!allowed, `${role} private USAGE`);
  }
  const [{ public_schema_usage }] = await query(client, "SELECT EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a WHERE n.nspname='private' AND a.grantee=0 AND a.privilege_type='USAGE') AS public_schema_usage");
  check(!public_schema_usage, "PUBLIC private USAGE");
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE anon");
    await client.query("SELECT * FROM public.devices LIMIT 0");
    await client.query("SELECT * FROM public.posts LIMIT 0");
    checks += 2;
  } finally { await client.query("ROLLBACK"); }
  const indexes = (await query(client, "SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='private' AND tablename LIKE 'ogh_%'")).map((r) => `${r.tablename}: ${r.indexdef}`);
  for (const pattern of [/ogh_verified_sessions:.*\(user_id, verified_at DESC\)/, /ogh_login_challenges:.*UNIQUE.*\(session_id\).*consumed_at IS NULL.*superseded_at IS NULL/, /ogh_login_challenges:.*\(user_id, created_at DESC\)/, /ogh_login_challenges:.*\(expires_at\)/, /ogh_policy_acceptances:.*\(user_id, accepted_at DESC\)/]) check(indexes.some((s) => pattern.test(s)), `index ${pattern}`);
  const [{ owner, security_definer, config, arguments: args, result, public_exec, anon_exec, auth_exec }] = await query(client, `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, p.proconfig AS config, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result, EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='ogh_is_verified_session'`);
  check(owner === "postgres" && security_definer && args.trim() === "" && result === "boolean" && config?.includes('search_path=""') && !public_exec && !anon_exec && auth_exec, `predicate metadata ${JSON.stringify({ owner, security_definer, config, args, result, public_exec, anon_exec, auth_exec })}`);
  await expectDenied(client, "anon", "SELECT public.ogh_is_verified_session()");
  const user = randomUUID(), other = randomUUID(), session = randomUUID(), wrongSession = randomUUID();
  await client.query("INSERT INTO auth.users (id, aud, role) VALUES ($1,'authenticated','authenticated'),($2,'authenticated','authenticated')", [user, other]);
  await client.query("INSERT INTO auth.sessions (id,user_id) VALUES ($1,$2)", [session, user]);
  check(!(await predicate(client, { role: "anon", user, session })), "anon false");
  check(!(await predicate(client, { user, session })), "pending false");
  await client.query("INSERT INTO private.ogh_verified_sessions (session_id,user_id,verification_kind) VALUES ($1,$2,'login_challenge')", [session, user]);
  check(await predicate(client, { user, session }), "matching live row true");
  for (const claims of [{ user: other, session }, { user, session: wrongSession }, { user, session: "bad" }, { user, session: undefined }, { user, session, anonymous: true }]) check(!(await predicate(client, claims)), `invalid claims ${JSON.stringify(claims)}`);
  await client.query("UPDATE private.ogh_verified_sessions SET revoked_at=now() WHERE session_id=$1", [session]);
  check(!(await predicate(client, { user, session })), "revoked false");
  await client.query("UPDATE private.ogh_verified_sessions SET revoked_at=NULL WHERE session_id=$1", [session]);
  await client.query("DELETE FROM auth.sessions WHERE id=$1", [session]);
  check(!(await predicate(client, { user, session })), "removed live session false");
  await client.query("INSERT INTO auth.sessions (id,user_id) VALUES ($1,$2)", [session, user]);
  check(await predicate(client, { user, session }), "restored live session true");
  await client.query("BEGIN");
  try {
    await client.query("ALTER TABLE private.ogh_verified_sessions RENAME TO ogh_verified_sessions_unavailable_test");
    check(!(await predicate(client, { user, session }, false)), "database lookup failure false");
  } finally { await client.query("ROLLBACK"); }
  await client.query("DELETE FROM auth.users WHERE id IN ($1,$2)", [user, other]);
}

let ownedRoot, started = false, pool;
try {
  ownedRoot = await mkdtemp(path.join(os.tmpdir(), `ogh-verified-sql-${id}-`));
  assert.equal(path.dirname(ownedRoot), os.tmpdir());
  await run(process.execPath, [cli, "init", "--yes", "--workdir", ownedRoot], ownedRoot);
  const configPath = path.join(ownedRoot, "supabase/config.toml");
  let config = await readFile(configPath, "utf8");
  config = config.replace(/^project_id = "[^"]+"/m, `project_id = "${projectId}"`);
  for (const section of ["api", "db", "studio", "local_smtp", "analytics", "db.pooler", "edge_runtime"]) {
    const match = config.match(new RegExp(`\\[${section.replaceAll(".", "\\.")}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    if (!match) throw new Error(`Missing local config section ${section}`);
    const key = section === "db" ? "port" : section === "edge_runtime" ? "inspector_port" : "port";
    const port = await freePort();
    config = config.replace(match[0], match[0].replace(new RegExp(`(^${key}\\s*=\\s*)\\d+`, "m"), `$1${port}`));
  }
  config = config.replace(/(\[db\][\s\S]*?\nshadow_port\s*=\s*)\d+/, `$1${await freePort()}`);
  await writeFile(configPath, config);
  const historical = path.join(ownedRoot, "historical-migrations");
  await mkdir(historical);
  for (const filename of ORDERED_MIGRATION_FILENAMES) {
    const bytes = execFileSync("git", ["-C", root, "cat-file", "blob", `HEAD:supabase/migrations/${filename}`]);
    await writeFile(path.join(historical, filename), bytes);
  }
  await buildLocalSupabaseReplayMirror({ canonicalDirectory: historical, outputDirectory: path.join(ownedRoot, "supabase/migrations"), mappingPath: path.join(ownedRoot, "mapping.json"), repositoryRoot: root });
  const files = await readdir(path.join(ownedRoot, "supabase/migrations"));
  const last = files.sort().at(-1);
  const next = String(BigInt(last.slice(0, 14)) + 1n);
  await cp(migration, path.join(ownedRoot, "supabase/migrations", `${next}_ogh_verified_session_v1.sql`));
  started = true;
  await run(process.execPath, [cli, "start", "--workdir", ownedRoot], ownedRoot);
  const statusOutput = await run(process.execPath, [cli, "status", "--output", "json", "--workdir", ownedRoot], ownedRoot);
  const status = JSON.parse(statusOutput.slice(statusOutput.indexOf("{"), statusOutput.lastIndexOf("}") + 1));
  const db = new URL(status.DB_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(db.hostname), "Only local DB target is allowed");
  pool = new pg.Pool({ connectionString: status.DB_URL, max: 1 });
  const client = await pool.connect();
  try { await verify(client); } finally { client.release(); }
  console.log(`PASS verified session SQL: ${checks} assertions; disposable local Supabase; four-table migration replay`);
} finally {
  await pool?.end();
  if (started) await run(process.execPath, [cli, "stop", "--no-backup", "--workdir", ownedRoot], ownedRoot);
  if (ownedRoot && path.dirname(ownedRoot) === os.tmpdir() && path.basename(ownedRoot).startsWith(`ogh-verified-sql-${id}-`)) await rm(ownedRoot, { recursive: true, force: true });
}
