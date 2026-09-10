import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Real PostgreSQL, owned temporary cluster, synthetic data only. No connection
// URL, .env, Supabase link, existing server, or production schema is consumed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = (n) => `'00000000-0000-0000-0000-${String(n).padStart(12, "0")}'`;
const definition = (n) => id(100 + n);
const spec = id(200);
const source = (n) => id(300 + n);
const quote = (s) => `'${s.replaceAll("'", "''")}'`;

function childEnvironment() {
  // Whitelisting also excludes PGOPTIONS, PGSERVICEFILE, PGPASSFILE and URLs.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|temp|tmp|comspec|pathext|lang|lc_all)$/i.test(key)));
}

function command(bin, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnvironment(), windowsHide: true, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    // On Windows postgres inherits pg_ctl's pipe handles after pg_ctl exits.
    // Waiting for `close` would wait for the long-lived server itself.
    child.on(path.basename(bin).replace(/\.exe$/i, "") === "pg_ctl" ? "exit" : "close", (code) => {
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}

function sqlSession(bin, args) {
  const child = spawn(bin, args, { env: childEnvironment(), windowsHide: true, stdio: "pipe" });
  let output = "", sequence = 0, pending;
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { pending?.({ code, output }); resolve({ code, output }); });
  });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.stdout.on("data", (chunk) => { output += chunk; pending?.(); });
  child.stdin.on("error", (error) => { if (error.code !== "EPIPE") throw error; });
  return {
    run(input) {
      const marker = `SESSION_READY_${++sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Local SQL session timed out")); }, 15000);
        pending = (exit) => {
          if (exit || output.includes(marker)) {
            clearTimeout(timeout); pending = undefined; resolve(exit ?? { code: 0, output });
          }
        };
        child.stdin.write(`${input}\n\\echo ${marker}\n`);
      });
    },
    async close() { child.stdin.end(); return closed; },
  };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function insertSpec(overrides = {}) {
  const values = { id: spec, device_id: id(1), spec_definition_id: definition(1), state: "'KNOWN'", value_number: "57", canonical_unit: "'g'", measurement_context: "'mass'", confidence: "'HIGH'", ...overrides };
  return `insert into public.device_specs (${Object.keys(values).join(",")}) values (${Object.values(values).join(",")});`;
}
function evidence(n, primary, conflicting, target = spec) {
  return `insert into public.device_spec_evidence (id,device_spec_id,source_id,claimed_value,is_primary,is_conflicting) values (${id(400 + n)},${target},${source(n)},'claim ${n}',${primary},${conflicting});`;
}
const conflict = (extra = {}) => insertSpec({ state: "'CONFLICT'", raw_value: "'57 g'", ...extra });
const validConflict = () => conflict() + evidence(1, true, false) + evidence(2, false, true);

function cases() {
  const tests = [];
  const good = (name, sql) => tests.push({ name, sql });
  const bad = (name, sql, error, code = "23514") => tests.push({ name, sql, error, code });
  const stateError = "DEVICE_SPEC_STATE_VALUE_MISMATCH";
  good("known number", insertSpec());
  good("new reference retains legacy device timestamp trigger", insertSpec() + `do $$ begin if not exists (select 1 from public.devices where id=${id(1)} and updated_at > '2000-01-01 UTC'::timestamptz) then raise exception 'Legacy device timestamp trigger did not run'; end if; end $$;`);
  for (const [n, column, value] of [[2, "value_boolean", "false"], [3, "value_text", "'Up to 120'"], [4, "value_json", "'{\"mode\":90}'::jsonb"]]) {
    good(`known ${column}`, insertSpec({ spec_definition_id: definition(n), value_number: "null", canonical_unit: "null", measurement_context: "null", [column]: value }));
  }
  bad("known requires typed value", insertSpec({ value_number: "null" }), stateError);
  bad("typed columns are exclusive", insertSpec({ value_text: "'57'" }), stateError);
  bad("row CHECK protects KNOWN without triggers", "set local session_replication_role=replica;" + insertSpec({ value_number: "null" }), stateError);
  bad("row CHECK protects typed exclusivity without triggers", "set local session_replication_role=replica;" + insertSpec({ value_text: "'57'" }), stateError);
  bad("row CHECK protects CONFLICT raw shape without triggers", "set local session_replication_role=replica;" + conflict({ raw_value: "null" }), stateError);
  for (const state of ["NOT_DISCLOSED", "NOT_APPLICABLE", "UNKNOWN_UNVERIFIED"]) {
    good(`${state} empty typed fields`, insertSpec({ state: quote(state), value_number: "null" }));
    bad(`${state} forbids typed fields`, insertSpec({ state: quote(state) }), stateError);
  }
  for (const value of ["null", "''", "'   '", "E'\\t\\n'"]) {
    bad(`conflict rejects empty raw ${value}`, conflict({ raw_value: value }), stateError);
  }
  good("conflict typed primary", validConflict());
  good("conflict raw-only primary", conflict({ value_number: "null", raw_value: "'3500 average / 6000 peak'" }) + evidence(1, true, false) + evidence(2, false, true));
  bad("conflict exclusive typed primary", conflict({ value_text: "'57'" }), stateError);
  bad("unknown definition named error", insertSpec({ spec_definition_id: definition(99) }), "DEVICE_SPEC_UNKNOWN_DEFINITION");
  bad("schema disallowed", insertSpec({ device_id: id(2) }), "DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED");
  bad("null schema disallowed", insertSpec({ device_id: id(3) }), "DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED");
  for (const state of ["NOT_DISCLOSED", "NOT_APPLICABLE", "UNKNOWN_UNVERIFIED"]) {
    bad(`${state} cannot bypass applicability`, insertSpec({ device_id: id(2), state: quote(state), value_number: "null" }), "DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED");
  }
  for (const [column, value] of [["value_boolean", "false"], ["value_text", "'57'"], ["value_json", "'{}'::jsonb"]]) {
    bad(`number rejects ${column}`, insertSpec({ value_number: "null", [column]: value }), "DEVICE_SPEC_VALUE_TYPE_MISMATCH");
  }
  for (const n of [2, 3, 4]) bad(`definition ${n} rejects number`, insertSpec({ spec_definition_id: definition(n), canonical_unit: "null", measurement_context: "null" }), "DEVICE_SPEC_VALUE_TYPE_MISMATCH");
  for (const value of ["null", "'kg'"]) bad(`unit mismatch ${value}`, insertSpec({ canonical_unit: value }), "DEVICE_SPEC_UNIT_MISMATCH");
  for (const value of ["null", "'eye_brightness'"]) bad(`context mismatch ${value}`, insertSpec({ measurement_context: value }), "DEVICE_SPEC_CONTEXT_MISMATCH");
  bad("null definition unit rejects supplied unit", insertSpec({ spec_definition_id: definition(2), value_number: "null", value_boolean: "false", measurement_context: "null" }), "DEVICE_SPEC_UNIT_MISMATCH");
  bad("null definition context rejects supplied context", insertSpec({ spec_definition_id: definition(2), value_number: "null", value_boolean: "false", canonical_unit: "null" }), "DEVICE_SPEC_CONTEXT_MISMATCH");
  bad("UPDATE validates type", insertSpec() + `update public.device_specs set value_number=null,value_boolean=false where id=${spec};`, "DEVICE_SPEC_VALUE_TYPE_MISMATCH");
  bad("UPDATE validates definition", insertSpec() + `update public.device_specs set spec_definition_id=${definition(99)} where id=${spec};`, "DEVICE_SPEC_UNKNOWN_DEFINITION");
  for (const value of ["'ai_hud'", "null"]) {
    bad(`device schema change rejects incompatible existing spec ${value}`, insertSpec() + `update public.devices set schema_type=${value} where id=${id(1)};`, "DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED");
  }
  good("device schema may change without specs", `update public.devices set schema_type='ai_hud' where id=${id(1)};`);
  good("device schema unchanged with specs", insertSpec() + `update public.devices set schema_type='display_ar' where id=${id(1)};`);
  good("device schema change allowed when definition supports both", `update public.device_spec_definitions set applicable_schema_types=array['display_ar','ai_hud']::public.device_schema_type[] where id=${definition(1)};` + insertSpec() + `update public.devices set schema_type='ai_hud' where id=${id(1)};`);
  const invariant = "DEVICE_SPEC_EVIDENCE_CONFLICT_INVARIANT";
  bad("conflict missing evidence at transaction end", conflict(), invariant);
  bad("conflict only primary", conflict() + evidence(1, true, false), invariant);
  bad("conflict only conflicting", conflict() + evidence(2, false, true), invariant);
  bad("conflict unmarked supporting row is insufficient", conflict() + evidence(1, true, false) + evidence(2, false, false), invariant);
  bad("primary cannot itself conflict", conflict() + evidence(1, true, true), "device_spec_evidence_primary_not_conflicting");
  bad("second primary rejected", validConflict() + evidence(3, true, false), "device_spec_evidence_one_primary_idx", "23505");
  for (const state of ["KNOWN", "NOT_DISCLOSED", "NOT_APPLICABLE", "UNKNOWN_UNVERIFIED"]) {
    bad(`${state} rejects conflicting evidence`, insertSpec({ state: quote(state), ...(state === "KNOWN" ? {} : { value_number: "null" }) }) + evidence(1, false, true), invariant);
  }
  good("state transition after inserting evidence is deferred", insertSpec() + evidence(1, true, false) + evidence(2, false, true) + `update public.device_specs set state='CONFLICT',raw_value='57 g' where id=${spec};`);
  good("resolve conflict in either operation order", validConflict() + `update public.device_specs set state='KNOWN' where id=${spec}; delete from public.device_spec_evidence where is_conflicting;`);
  bad("resolve state without evidence cleanup rejected", validConflict() + `update public.device_specs set state='KNOWN' where id=${spec};`, invariant);
  bad("delete primary revalidates", validConflict() + `delete from public.device_spec_evidence where is_primary;`, invariant);
  bad("delete last conflicting revalidates", validConflict() + `delete from public.device_spec_evidence where is_conflicting;`, invariant);
  bad("unmark last conflicting revalidates", validConflict() + `update public.device_spec_evidence set is_conflicting=false where is_conflicting;`, invariant);
  good("replacement conflicting row within transaction", validConflict() + `delete from public.device_spec_evidence where is_conflicting;` + evidence(3, false, true));
  const other = id(201);
  bad("evidence move revalidates old spec", validConflict() + conflict({ id: other, region: "'NZ'" }) + evidence(3, true, false, other) + `update public.device_spec_evidence set device_spec_id=${other} where is_conflicting;`, invariant);
  bad("evidence move revalidates new spec", validConflict() + evidence(3, false, true) + insertSpec({ id: other, region: "'NZ'" }) + `update public.device_spec_evidence set device_spec_id=${other} where id=${id(403)};`, invariant);
  good("delete evidence then spec leaves no deferred ghost", validConflict() + `delete from public.device_spec_evidence; delete from public.device_specs where id=${spec};`);
  for (const [column, value] of [["key", "'renamed'"], ["value_type", "'text'"], ["canonical_unit", "'kg'"], ["measurement_context", "'other'"], ["comparison_mode", "'higher'"], ["require_same_context", "false"], ["applicable_schema_types", "array['ai_hud']::public.device_schema_type[]"]]) {
    bad(`referenced definition locks ${column}`, insertSpec() + `update public.device_spec_definitions set ${column}=${value} where id=${definition(1)};`, "DEVICE_SPEC_DEFINITION_SEMANTIC_CHANGE");
  }
  bad("referenced definition cannot be deleted", insertSpec() + `delete from public.device_spec_definitions where id=${definition(1)};`, "DEVICE_SPEC_DEFINITION_REFERENCED");
  good("referenced definition presentation edits and deactivation", insertSpec() + `update public.device_spec_definitions set label='Edited',help_text='Help',admin_order=9,is_active=false where id=${definition(1)};`);
  good("unreferenced definition semantic edits", `update public.device_spec_definitions set key='unused',value_type='text',canonical_unit=null where id=${definition(1)};`);
  good("unreferenced definition delete", `delete from public.device_spec_definitions where id=${definition(1)};`);
  good("null-safe uniqueness accepts different region", insertSpec() + insertSpec({ id: other, region: "'NZ'" }));
  bad("null region/variant cannot duplicate defaults", insertSpec() + insertSpec({ id: other, region: "null", variant: "null" }), "device_specs_identity_context_key", "23505");
  const audit = `insert into public.catalog_audit_events (entity_type,entity_id,action,changed_fields) values ('synthetic',${spec},'insert','{}');`;
  good("audit append", audit);
  bad("audit update denied", audit + "update public.catalog_audit_events set action='edit';", "CATALOG_AUDIT_APPEND_ONLY");
  bad("audit delete denied", audit + "delete from public.catalog_audit_events;", "CATALOG_AUDIT_APPEND_ONLY");
  return tests;
}

export async function runEnforcement() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-schema-v1-enforcement-"));
  const data = path.join(temporaryRoot, "data");
  const port = await unusedPort();
  // Optional executable directory, never a connection target. Otherwise PATH.
  const binary = (name) => process.env.DEVICE_SCHEMA_V1_PG_BIN ? path.join(process.env.DEVICE_SCHEMA_V1_PG_BIN, name + (process.platform === "win32" ? ".exe" : "")) : name;
  let initialized = false;
  let started = false;
  const checked = async (name, args, input) => {
    const result = await command(binary(name), args, input);
    assert.equal(result.code, 0, `${name} failed: ${result.output}`);
    return result.output;
  };
  const psqlArgs = ["-X", "-w", "-h", "127.0.0.1", "-p", String(port), "-U", "schema_v1_test", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At"];
  const sql = (input) => command(binary("psql"), psqlArgs, input);
  try {
    await checked("initdb", ["-D", data, "-U", "schema_v1_test", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
    initialized = true;
    const logPath = path.join(temporaryRoot, "postgres.log");
    const start = await command(binary("pg_ctl"), ["-D", data, "-l", logPath, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "20", "start"]);
    assert.equal(start.code, 0, `pg_ctl failed: ${start.output}\n${await readFile(logPath, "utf8").catch(() => "(no server log)")}`);
    started = true;
    const migrations = (await readdir(path.join(root, "supabase/migrations"))).filter((name) => /^\d{14}_device_schema_v1_foundation\.sql$/.test(name));
    assert.equal(migrations.length, 1, "Expected exactly one foundation migration");
    const migration = await readFile(path.join(root, "supabase/migrations", migrations[0]), "utf8");
    const fixture = await readFile(path.join(root, "tests/fixtures/device-schema-v1/enforcement-bootstrap.sql"), "utf8");
    const setup = await sql(`create table public.profiles (id uuid primary key); create table public.devices (id uuid primary key);\n${migration}\n${fixture}`);
    assert.equal(setup.code, 0, `Migration/fixture failed: ${setup.output}`);
    const failures = [];
    for (const test of cases()) {
      const result = await sql(`begin; set local statement_timeout='10s'; ${test.sql}\nset constraints all immediate; rollback;`);
      try {
        if (test.error) {
          assert.notEqual(result.code, 0, `${test.name}: missing expected ${test.error}`);
          assert.match(result.output, new RegExp(`ERROR:\\s+${test.code}:`), `${test.name}: SQLSTATE`);
          assert.ok(result.output.includes(test.error), `${test.name}: missing ${test.error}: ${result.output}`);
        } else assert.equal(result.code, 0, `${test.name}: ${result.output}`);
      } catch (error) { failures.push(error.message); }
    }
    // Test actual COMMIT timing as well as explicit SET CONSTRAINTS.
    const commit = await sql(`begin; ${validConflict()} commit;`);
    if (commit.code !== 0) failures.push(`valid COMMIT rejected: ${commit.output}`);
    const invalidCommit = await sql(`begin; delete from public.device_spec_evidence where is_conflicting; commit;`);
    if (invalidCommit.code === 0 || !/ERROR:\s+23514:.*DEVICE_SPEC_EVIDENCE_CONFLICT_INVARIANT/.test(invalidCommit.output)) failures.push("invalid COMMIT did not raise DEVICE_SPEC_EVIDENCE_CONFLICT_INVARIANT / 23514");
    // Two real sessions deliberately retain old snapshots. Merely locking the
    // parent during a deferred SELECT does not prevent REPEATABLE READ skew.
    assert.equal((await sql(evidence(3, false, true))).code, 0);
    const staleEvidence = sqlSession(binary("psql"), psqlArgs);
    try {
      assert.equal((await staleEvidence.run("begin isolation level repeatable read; select count(*) from public.device_spec_evidence;")).code, 0);
      assert.equal((await sql(`delete from public.device_spec_evidence where id=${id(402)};`)).code, 0);
      const result = await staleEvidence.run(`delete from public.device_spec_evidence where id=${id(403)}; commit;`);
      if (result.code === 0 || !/ERROR:\s+(40001|23514):/.test(result.output)) failures.push("concurrent evidence deletions bypassed final conflict invariant");
    } finally { await staleEvidence.close(); }
    assert.equal((await sql("begin; delete from public.device_spec_evidence; delete from public.device_specs; commit;")).code, 0);
    const staleDefinition = sqlSession(binary("psql"), psqlArgs);
    try {
      assert.equal((await staleDefinition.run("begin isolation level repeatable read; select count(*) from public.device_specs;")).code, 0);
      assert.equal((await sql(insertSpec())).code, 0);
      const result = await staleDefinition.run(`update public.device_spec_definitions set canonical_unit='kg' where id=${definition(1)}; commit;`);
      if (result.code === 0 || !/ERROR:\s+(40001|23514):/.test(result.output)) failures.push("concurrent first reference bypassed definition immutability");
    } finally { await staleDefinition.close(); }
    assert.equal((await sql("delete from public.device_specs;")).code, 0);
    const staleDevice = sqlSession(binary("psql"), psqlArgs);
    try {
      assert.equal((await staleDevice.run("begin isolation level repeatable read; select count(*) from public.device_specs;")).code, 0);
      assert.equal((await sql(insertSpec())).code, 0);
      const result = await staleDevice.run(`update public.devices set schema_type='ai_hud' where id=${id(1)}; commit;`);
      if (result.code === 0 || !/ERROR:\s+(40001|23514):/.test(result.output)) failures.push("concurrent first spec bypassed device schema applicability");
    } finally { await staleDevice.close(); }
    assert.equal(failures.length, 0, `${failures.length} enforcement failures:\n${failures.join("\n")}`);
    console.log(`DEVICE_SCHEMA_V1_ENFORCEMENT_OK cases=${cases().length + 5} postgres=local-disposable`);
  } finally {
    // Stop only the cluster owned by this invocation. Keep files if stop fails.
    if (initialized) {
      const stop = await command(binary("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "-t", "20", "stop"]);
      if (stop.code !== 0) {
        const status = await command(binary("pg_ctl"), ["-D", data, "status"]);
        assert.ok(!started && status.code === 3, `Owned PostgreSQL cleanup failed; retained ${temporaryRoot}: ${stop.output}`);
      }
    }
    const relative = path.relative(os.tmpdir(), temporaryRoot);
    assert.ok(relative && !relative.startsWith("..") && path.basename(temporaryRoot).startsWith("openglass-schema-v1-enforcement-"));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEnforcement().catch((error) => { console.error(`DEVICE_SCHEMA_V1_ENFORCEMENT_FAIL ${error.message}`); process.exitCode = 1; });
}
