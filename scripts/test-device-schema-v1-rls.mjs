import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Real PostgreSQL, owned temporary cluster, synthetic data only. No external
// database, credentials, Supabase project, or production data is contacted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userId = {
  user: "00000000-0000-0000-0000-000000000011",
  moderator: "00000000-0000-0000-0000-000000000012",
  admin: "00000000-0000-0000-0000-000000000013",
};
const deviceId = "00000000-0000-0000-0000-000000000101";
const definitionId = "00000000-0000-0000-0000-000000000102";

function childEnvironment() {
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
    child.on(path.basename(bin).replace(/\.exe$/i, "") === "pg_ctl" ? "exit" : "close", (code) => {
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function asRole(role, subject, sql) {
  const claims = subject ? `set local request.jwt.claim.sub = '${subject}';` : "";
  return `begin; set local role ${role}; ${claims}${sql} rollback;`;
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-schema-v1-rls-"));
  const data = path.join(temporaryRoot, "data");
  const port = await unusedPort();
  const binary = (name) => process.env.DEVICE_SCHEMA_V1_PG_BIN ? path.join(process.env.DEVICE_SCHEMA_V1_PG_BIN, name + (process.platform === "win32" ? ".exe" : "")) : name;
  let initialized = false;
  try {
    const checked = async (name, args, input) => {
      const result = await command(binary(name), args, input);
      assert.equal(result.code, 0, `${name} failed: ${result.output}`);
      return result;
    };
    await checked("initdb", ["-D", data, "-U", "schema_v1_test", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
    initialized = true;
    const logPath = path.join(temporaryRoot, "postgres.log");
    const start = await command(binary("pg_ctl"), ["-D", data, "-l", logPath, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "20", "start"]);
    assert.equal(start.code, 0, `pg_ctl failed: ${start.output}`);
    const args = ["-X", "-w", "-h", "127.0.0.1", "-p", String(port), "-U", "schema_v1_test", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"];
    const sql = (input) => command(binary("psql"), args, input);
    const migration = await readFile(path.join(root, "supabase/migrations/20260909195640_device_schema_v1_foundation.sql"), "utf8");
    const setup = await sql(`
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.user_role as enum ('user', 'moderator', 'admin');
create table public.profiles (id uuid primary key, role public.user_role not null);
create table public.devices (
  id uuid primary key, slug text not null unique, brand_key text not null, brand_name text not null,
  name text not null, short_description text not null, long_description text not null,
  image_alt text not null, category text not null, route_label text not null,
  route_description text not null, publication_status text not null default 'draft'
);
create function public.current_user_role() returns public.user_role language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;
create function public.is_moderator_or_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.current_user_role() in ('moderator', 'admin')), false)
$$;
create role anon nologin;
create role authenticated nologin;
alter table public.devices enable row level security;
create policy devices_select_published_public on public.devices for select to anon, authenticated using (publication_status = 'published');
create policy devices_select_staff_all on public.devices for select to authenticated using ((select public.is_moderator_or_admin()));
create policy devices_insert_staff on public.devices for insert to authenticated with check ((select public.is_moderator_or_admin()));
create policy devices_update_staff on public.devices for update to authenticated using ((select public.is_moderator_or_admin())) with check ((select public.is_moderator_or_admin()));
create policy devices_delete_staff on public.devices for delete to authenticated using ((select public.is_moderator_or_admin()));
grant usage on schema public, auth to anon, authenticated;
grant select, insert, update, delete on public.devices to anon, authenticated;
grant execute on function auth.uid(), public.current_user_role(), public.is_moderator_or_admin() to anon, authenticated;
insert into public.profiles (id, role) values ('${userId.user}', 'user'), ('${userId.moderator}', 'moderator'), ('${userId.admin}', 'admin');
insert into public.devices (id,slug,brand_key,brand_name,name,short_description,long_description,image_alt,category,route_label,route_description,publication_status)
values ('${deviceId}','published-device','brand','Brand','Published','short','long','alt','category','route','route description','published');
${migration}
`);
    assert.equal(setup.code, 0, `Migration setup failed: ${setup.output}`);

    const cases = [
      ["anon cannot mutate catalog", asRole("anon", null, `insert into public.devices (id,slug,brand_key,brand_name,name,short_description,long_description,image_alt,category,route_label,route_description) values ('00000000-0000-0000-0000-000000000201','anon','brand','Brand','Anon','short','long','alt','category','route','route description');`), (result) => result.code !== 0],
      ["user cannot mutate catalog", asRole("authenticated", userId.user, `update public.devices set name='User changed' where id='${deviceId}'; select name from public.devices where id='${deviceId}';`), (result) => result.code === 0 && result.output.includes("Published") && !result.output.includes("User changed")],
      ["moderator cannot mutate catalog", asRole("authenticated", userId.moderator, `delete from public.devices where id='${deviceId}'; select count(*) from public.devices where id='${deviceId}';`), (result) => result.code === 0 && result.output.includes("DELETE 0") && result.output.includes("\n1\n")],
      ["admin can mutate catalog", asRole("authenticated", userId.admin, `update public.devices set name='Admin changed' where id='${deviceId}'; select name from public.devices where id='${deviceId}';`), (result) => result.code === 0 && result.output.includes("UPDATE 1") && result.output.includes("Admin changed")],
      ["published device remains publicly readable", asRole("anon", null, `select id from public.devices where id='${deviceId}';`), (result) => result.code === 0 && result.output.includes(deviceId)],
      ["anon cannot directly select normalized definitions", asRole("anon", null, "select * from public.device_spec_definitions;"), (result) => result.code !== 0],
      ["admin can append and read audit", asRole("authenticated", userId.admin, `insert into public.catalog_audit_events (entity_type,entity_id,action,changed_fields) values ('device','${deviceId}','update','{}'); select action from public.catalog_audit_events;`), (result) => result.code === 0 && result.output.includes("INSERT 0 1") && result.output.includes("update")],
      ["moderator cannot append audit", asRole("authenticated", userId.moderator, `insert into public.catalog_audit_events (entity_type,entity_id,action,changed_fields) values ('device','${deviceId}','update','{}');`), (result) => result.code !== 0],
      ["admin cannot update audit", asRole("authenticated", userId.admin, `insert into public.catalog_audit_events (entity_type,entity_id,action,changed_fields) values ('device','${deviceId}','update','{}'); update public.catalog_audit_events set action='delete';`), (result) => result.code !== 0],
      ["admin cannot delete audit", asRole("authenticated", userId.admin, `insert into public.catalog_audit_events (entity_type,entity_id,action,changed_fields) values ('device','${deviceId}','update','{}'); delete from public.catalog_audit_events;`), (result) => result.code !== 0],
    ];
    const failures = [];
    for (const [name, statement, expected] of cases) {
      const result = await sql(statement);
      const normalized = { ...result, output: result.output.replaceAll("\r", "") };
      if (!expected(normalized)) failures.push(`${name}: policy mismatch, received code=${result.code}: ${result.output}`);
    }
    assert.equal(failures.length, 0, `${failures.length} RLS/grant assertions failed:\n${failures.join("\n")}`);
    console.log(`DEVICE_SCHEMA_V1_RLS_OK cases=${cases.length} postgres=local-disposable`);
  } finally {
    if (initialized) await command(binary("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "-t", "20", "stop"]);
    const relative = path.relative(os.tmpdir(), temporaryRoot);
    assert.ok(relative && !relative.startsWith("..") && path.basename(temporaryRoot).startsWith("openglass-schema-v1-rls-"));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(`DEVICE_SCHEMA_V1_RLS_FAIL ${error.message}`); process.exitCode = 1; });
