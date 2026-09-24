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
import { verifyBypass } from "./test-verified-session-bypass.mjs";

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
const signatures = [
  ["ogh_reserve_login_challenge", "uuid, uuid, uuid, bytea, text, boolean", "text", "service_role"],
  ["ogh_finalize_login_delivery", "uuid, uuid, uuid, boolean", "boolean", "service_role"],
  ["ogh_consume_login_challenge", "uuid, uuid, uuid, bytea", "text", "service_role"],
  ["ogh_activate_signup_session", "uuid, uuid", "boolean", "service_role"],
  ["ogh_revoke_verified_session", "uuid, uuid", "boolean", "service_role"],
  ["ogh_record_policy_acceptance", "uuid, text, text, text, text, text", "void", "service_role"],
  ["ogh_has_current_policy_acceptance", "text, text, text, text", "boolean", "authenticated"],
];
const digest = Buffer.alloc(32, 7);
const otherDigest = Buffer.alloc(32, 8);
async function rpc(client, name, args) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  return (await query(client, `SELECT public.${name}(${placeholders}) AS value`, args))[0].value;
}
async function actorRpc(pool, role, name, args, claims) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    if (claims) await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    const value = await rpc(client, name, args);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function verifyTask3(client, pool) {
  for (const table of expectedTables) {
    const [{ allowed }] = await query(client,"SELECT has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[`private.${table}`]);
    check(!allowed,`service_role cannot access ${table} directly`);
    await expectDenied(client,"service_role",`SELECT * FROM private.${table}`);
  }
  const [{ schema_usage }] = await query(client,"SELECT has_schema_privilege('service_role','private','USAGE') AS schema_usage");
  check(!schema_usage,"service_role cannot use private schema directly");
  for (const [name, args, result, role] of signatures) {
    const rows = await query(client, `SELECT p.oid, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer, p.proconfig AS config,
      pg_get_function_result(p.oid) AS result,
      EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1 AND p.oid=to_regprocedure($2)`, [name, `public.${name}(${args})`]);
    check(rows.length === 1, `missing function public.${name}(${args})`);
    const f = rows[0];
    check(f.owner === "postgres" && f.definer && f.config?.includes('search_path=""') && f.result === result,
      `${name} owner, security, search path, result`);
    check(!f.public_exec && !f.anon_exec && f.auth_exec === (role === "authenticated") && f.service_exec === (role === "service_role"), `${name} ACL`);
    if (role === "service_role") await expectDenied(client, "authenticated", `SELECT public.${name}(${args.split(", ").map((a) => a === "uuid" ? "NULL::uuid" : a === "bytea" ? "NULL::bytea" : a === "boolean" ? "NULL::boolean" : "NULL::text").join(",")})`);
  }
  const all = await query(client, "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'ogh_%'");
  check(all.length === 8, "exactly eight public ogh functions");

  const user = randomUUID(), other = randomUUID(), s1 = randomUUID(), s2 = randomUUID(), missing = randomUUID();
  await client.query("INSERT INTO auth.users (id,aud,role) VALUES ($1,'authenticated','authenticated'),($2,'authenticated','authenticated')", [user, other]);
  await client.query("INSERT INTO auth.sessions (id,user_id) VALUES ($1,$2),($3,$2)", [s1,user,s2]);
  const reserve = (session, challenge, code = digest, ip = "ip-a", resend = false, who = user) =>
    actorRpc(pool, "service_role", "ogh_reserve_login_challenge", [who,session,challenge,code,ip,resend]);
  const finalize = (session, challenge, accepted = true, who = user) => actorRpc(pool,"service_role","ogh_finalize_login_delivery",[who,session,challenge,accepted]);
  const consume = (session, challenge, code = digest, who = user) => actorRpc(pool,"service_role","ogh_consume_login_challenge",[who,session,challenge,code]);
  const c1 = randomUUID(), c2 = randomUUID();
  check(await reserve(missing,randomUUID()) === "SESSION_GONE", "missing session cannot reserve");
  check(await reserve(s1,randomUUID(),digest,"ip-a",false,other) === "SESSION_GONE", "foreign session cannot reserve");
  const starts = await Promise.all([reserve(s1,c1), reserve(s1,c2)]);
  check(starts.filter((v) => v === "RESERVED").length === 1 && starts.includes("PENDING"), "two starts reserve once");
  const active = starts[0] === "RESERVED" ? c1 : c2;
  check(await reserve(s1,randomUUID()) === "PENDING", "duplicate start pending");
  check(await consume(s1,active) === "CHALLENGE_INVALID", "reserved code unusable");
  check(await finalize(s1,active,false), "rejected delivery finalized");
  check(await consume(s1,active) === "CHALLENGE_INVALID", "rejected code unusable");
  check(!(await finalize(s1,active,true)), "ambiguous delivery cannot become accepted");
  check(await reserve(s1,randomUUID(),digest,"ip-a",true) === "RESEND_COOLDOWN", "resend cooldown");
  await client.query("UPDATE private.ogh_login_challenges SET next_send_at=clock_timestamp()-interval '1 second' WHERE id=$1", [active]);
  const r1=randomUUID(), r2=randomUUID();
  const resends=await Promise.all([reserve(s1,r1,digest,"ip-a",true),reserve(s1,r2,digest,"ip-a",true)]);
  check(resends.filter((v)=>v==="RESERVED").length===1 && resends.includes("RESEND_COOLDOWN"),"simultaneous resend reserves once");
  const current=resends[0]==="RESERVED"?r1:r2;
  check(await finalize(s1,current), "accepted delivery finalized");
  check(await consume(s1,active) === "CHALLENGE_SUPERSEDED", "superseded code rejected");
  check(await consume(s2,current) === "CHALLENGE_INVALID", "cross-session code rejected");
  check(await consume(s1,current,otherDigest) === "CHALLENGE_INVALID", "wrong digest rejected");
  const double=await Promise.all([consume(s1,current),consume(s1,current)]);
  check(double.filter((v)=>v==="VERIFIED").length===1 && double.includes("CHALLENGE_INVALID"), "same code double consume verifies once");
  check(await predicate(client,{user,session:s1}), "consumption creates verified session");
  const row=await query(client,"SELECT verified_at,verification_kind FROM private.ogh_verified_sessions WHERE session_id=$1",[s1]);
  check(row.length===1 && row[0].verification_kind==="login_challenge" &&
    Math.abs(Date.now()-row[0].verified_at.getTime())<120000, "one login verification row with DB time");
  const stale=await query(client,"SELECT count(*)::int AS n FROM private.ogh_verified_sessions WHERE session_id=$1",[s2]);
  check(stale[0].n===0,"other session remains pending");

  const c3=randomUUID();
  check(await reserve(s2,c3) === "RESERVED", "second session starts");
  check(await finalize(s2,c3),"second session delivery accepted");
  await client.query("UPDATE private.ogh_login_challenges SET attempts=4 WHERE id=$1",[c3]);
  const finalAttempts=await Promise.all([consume(s2,c3,otherDigest),consume(s2,c3,digest)]);
  check(finalAttempts.filter((v)=>v==="VERIFIED").length<=1 &&
    (finalAttempts.includes("CHALLENGE_EXHAUSTED") || finalAttempts.includes("VERIFIED")), "fifth attempt race has one terminal outcome");
  const attempts=await query(client,"SELECT attempts FROM private.ogh_login_challenges WHERE id=$1",[c3]);
  check(attempts[0].attempts>=4 && attempts[0].attempts<=5,"fifth attempt counted at most once");

  const sessions=Array.from({length:8},()=>randomUUID());
  for(const session of sessions) await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[session,other]);
  const budget=await Promise.all(sessions.map((session)=>reserve(session,randomUUID(),digest,"ip-b",false,other)));
  check(budget.filter((v)=>v==="RESERVED").length===5 && budget.filter((v)=>v==="EMAIL_BUDGET_EXHAUSTED").length===3,"user budget race capped at five");
  const day=await query(client,"SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS day");
  const counts=await query(client,"SELECT scope, max(send_count) AS count FROM private.ogh_email_send_budget WHERE utc_day=$1 GROUP BY scope",[day[0].day]);
  check(counts.find((r)=>r.scope==="user")?.count===5 && counts.find((r)=>r.scope==="global")?.count<=100,"quota counters bounded");

  const sg=randomUUID();
  await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[sg,user]);
  check(await actorRpc(pool,"service_role","ogh_activate_signup_session",[user,sg]),"signup activation");
  check(await actorRpc(pool,"service_role","ogh_revoke_verified_session",[user,sg]),"signup revoke");
  check(!(await predicate(client,{user,session:sg})),"revoked signup session denied");
  const revoked=await query(client,"SELECT verified_at,revoked_at FROM private.ogh_verified_sessions WHERE session_id=$1",[sg]);
  check(revoked[0].revoked_at>=revoked[0].verified_at && Math.abs(Date.now()-revoked[0].revoked_at.getTime())<120000,"revocation timestamp uses DB time");
  check(!(await actorRpc(pool,"service_role","ogh_activate_signup_session",[other,sg])),"foreign signup session denied");
  check(!(await actorRpc(pool,"service_role","ogh_activate_signup_session",[user,missing])),"missing signup session denied");

  const bundle="bundle-v1", terms="terms-v1", privacy="privacy-v1", guidelines="guidelines-v1";
  const policy=(who,versions=[bundle,terms,privacy,guidelines])=>actorRpc(pool,"authenticated","ogh_has_current_policy_acceptance",versions,{sub:who,role:"authenticated",is_anonymous:false});
  check(!(await policy(user)),"no acceptance false");
  await actorRpc(pool,"service_role","ogh_record_policy_acceptance",[user,bundle,terms,privacy,guidelines,"login"]);
  check(await policy(user),"new policy acceptance true");
  check(!(await policy(other)),"policy user isolation");
  check(!(await policy(user,[bundle,terms,"privacy-v2",guidelines])),"version mismatch false");
  await client.query("INSERT INTO public.legal_policy_acceptances(user_id,bundle_version,terms_version,privacy_version,guidelines_version,minimum_age,first_acceptance_source,last_confirmation_source) VALUES($1,$2,$3,$4,$5,15,'registration','registration')",[other,bundle,terms,privacy,guidelines]);
  check(await policy(other),"historical differing-age row accepted by versions");
  check(!(await actorRpc(pool,"authenticated","ogh_has_current_policy_acceptance",[bundle,terms,privacy,guidelines],{sub:other,role:"authenticated",is_anonymous:true})),"anonymous claim denied");
  const accepted=await query(client,"SELECT accepted_at FROM private.ogh_policy_acceptances WHERE user_id=$1 AND bundle_version=$2",[user,bundle]);
  check(Math.abs(Date.now()-accepted[0].accepted_at.getTime())<120000,"policy timestamp uses DB time");
  await assert.rejects(actorRpc(pool,"service_role","ogh_record_policy_acceptance",[user,bundle,terms,privacy,guidelines,"bad_source"]),(error)=>error.code==="22023"); checks++;

  const extraUsers=Array.from({length:5},()=>randomUUID());
  const extraSessions=Array.from({length:5},()=>randomUUID());
  for(let i=0;i<extraUsers.length;i++) {
    await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[extraUsers[i]]);
    await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[extraSessions[i],extraUsers[i]]);
  }
  const [resendUser, expiryUser, goneUser, raceUser, quotaUser]=extraUsers;
  const [resendSession, expirySession, goneSession, raceSession, quotaSession]=extraSessions;
  let prior=randomUUID();
  check(await reserve(resendSession,prior,digest,"ip-resend",false,resendUser)==="RESERVED","first send");
  await client.query("UPDATE private.ogh_login_challenges SET attempts=2 WHERE id=$1",[prior]);
  for(let n=2;n<=3;n++) {
    await client.query("UPDATE private.ogh_login_challenges SET next_send_at=clock_timestamp()-interval '1 second' WHERE id=$1",[prior]);
    const next=randomUUID();
    check(await reserve(resendSession,next,digest,"ip-resend",true,resendUser)==="RESERVED",`send ${n}`);
    prior=next;
  }
  check(await reserve(resendSession,randomUUID(),digest,"ip-resend",true,resendUser)==="EMAIL_BUDGET_EXHAUSTED","three sends per session across rows");
  const lineage=await query(client,"SELECT attempts,send_count,created_at,expires_at,next_send_at FROM private.ogh_login_challenges WHERE id=$1",[prior]);
  check(lineage[0].attempts===2 && lineage[0].send_count===3 && lineage[0].expires_at.getTime()-lineage[0].created_at.getTime()===600000 &&
    lineage[0].next_send_at.getTime()-lineage[0].created_at.getTime()===60000,"DB controls expiry and resend times");

  const expired=randomUUID();
  check(await reserve(expirySession,expired,digest,"ip-expiry",false,expiryUser)==="RESERVED","expiry fixture start");
  check(await finalize(expirySession,expired,true,expiryUser),"expiry fixture delivered");
  await client.query("UPDATE private.ogh_login_challenges SET created_at=clock_timestamp()-interval '12 minutes', expires_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",[expired]);
  check(await consume(expirySession,expired,digest,expiryUser)==="CHALLENGE_EXPIRED","expired accepted code rejected");

  const vanished=randomUUID();
  check(await reserve(goneSession,vanished,digest,"ip-gone",false,goneUser)==="RESERVED","gone fixture start");
  check(await finalize(goneSession,vanished,true,goneUser),"gone fixture delivered");
  await client.query("DELETE FROM auth.sessions WHERE id=$1",[goneSession]);
  check(await consume(goneSession,vanished,digest,goneUser)==="SESSION_GONE","session disappears between start and consume");

  const logoutChallenge=randomUUID();
  check(await reserve(raceSession,logoutChallenge,digest,"ip-race",false,raceUser)==="RESERVED","logout race start");
  check(await finalize(raceSession,logoutChallenge,true,raceUser),"logout race delivered");
  const logoutRace=await Promise.all([
    consume(raceSession,logoutChallenge,digest,raceUser),
    actorRpc(pool,"service_role","ogh_revoke_verified_session",[raceUser,raceSession]),
  ]);
  check(logoutRace[1]===true && ["VERIFIED","CHALLENGE_SUPERSEDED"].includes(logoutRace[0]),"logout and verify serialize");
  check(!(await predicate(client,{user:raceUser,session:raceSession})),"logout race ends unverified");

  const pendingUser=randomUUID(), pendingSession=randomUUID(), pendingChallenge=randomUUID();
  await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[pendingUser]);
  await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[pendingSession,pendingUser]);
  check(await reserve(pendingSession,pendingChallenge,digest,"ip-pending",false,pendingUser)==="RESERVED","pending revoke fixture reserved");
  check(await finalize(pendingSession,pendingChallenge,true,pendingUser),"pending revoke fixture accepted");
  check(await actorRpc(pool,"service_role","ogh_revoke_verified_session",[pendingUser,pendingSession]),"pending session revoked before provider signout");
  const pendingMarker=await query(client,"SELECT verified_at,revoked_at FROM private.ogh_verified_sessions WHERE session_id=$1",[pendingSession]);
  check(pendingMarker.length===1 && pendingMarker[0].revoked_at!==null,"pending revocation persists a deny marker");
  const pendingBudgetBefore=await query(client,"SELECT scope,send_count FROM private.ogh_email_send_budget WHERE scope='session' AND scope_key=$1",[pendingSession]);
  check(await reserve(pendingSession,randomUUID(),digest,"ip-pending",false,pendingUser)!=="RESERVED","revoked pending session cannot start again while live");
  const pendingBudgetAfter=await query(client,"SELECT scope,send_count FROM private.ogh_email_send_budget WHERE scope='session' AND scope_key=$1",[pendingSession]);
  check(JSON.stringify(pendingBudgetAfter)===JSON.stringify(pendingBudgetBefore),"revoked pending start does not charge quota");
  check(await consume(pendingSession,pendingChallenge,digest,pendingUser)!=="VERIFIED","revoked pending challenge cannot verify");
  check(!(await actorRpc(pool,"service_role","ogh_activate_signup_session",[pendingUser,pendingSession])),"revoked pending session cannot activate signup");
  check(!(await predicate(client,{user:pendingUser,session:pendingSession})),"revoked pending session fails predicate");
  const pendingWithoutChallenge=randomUUID();
  await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[pendingWithoutChallenge,pendingUser]);
  check(await actorRpc(pool,"service_role","ogh_revoke_verified_session",[pendingUser,pendingWithoutChallenge]),"pending session without challenge revokes");
  check(await reserve(pendingWithoutChallenge,randomUUID(),digest,"ip-pending",false,pendingUser)!=="RESERVED","challenge-free revoked session cannot start");

  const exhaustedUser=randomUUID(), exhaustedSession=randomUUID(), exhaustedChallenge=randomUUID();
  await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[exhaustedUser]);
  await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[exhaustedSession,exhaustedUser]);
  check(await reserve(exhaustedSession,exhaustedChallenge,digest,"ip-exhausted",false,exhaustedUser)==="RESERVED","exhaustion fixture reserved");
  check(await finalize(exhaustedSession,exhaustedChallenge,true,exhaustedUser),"exhaustion fixture delivered");
  for(let n=0;n<5;n++) await consume(exhaustedSession,exhaustedChallenge,otherDigest,exhaustedUser);
  const exhaustedState=await query(client,"SELECT attempts FROM private.ogh_login_challenges WHERE id=$1",[exhaustedChallenge]);
  check(exhaustedState[0].attempts===5,"five wrong attempts exhaust challenge");
  await client.query("UPDATE private.ogh_login_challenges SET next_send_at=clock_timestamp()-interval '1 second' WHERE id=$1",[exhaustedChallenge]);
  const budgetBefore=await query(client,"SELECT scope,scope_key,send_count FROM private.ogh_email_send_budget WHERE scope_key=ANY($1::text[]) ORDER BY scope,scope_key",[["all",exhaustedUser,exhaustedSession,"ip-exhausted"]]);
  check(await reserve(exhaustedSession,randomUUID(),digest,"ip-exhausted",true,exhaustedUser)!=="RESERVED","exhausted challenge cannot reserve resend");
  const budgetAfter=await query(client,"SELECT scope,scope_key,send_count FROM private.ogh_email_send_budget WHERE scope_key=ANY($1::text[]) ORDER BY scope,scope_key",[["all",exhaustedUser,exhaustedSession,"ip-exhausted"]]);
  check(JSON.stringify(budgetAfter)===JSON.stringify(budgetBefore),"exhausted resend charges no quota");
  const activeExhausted=await query(client,"SELECT count(*)::int AS n FROM private.ogh_login_challenges WHERE session_id=$1 AND consumed_at IS NULL AND superseded_at IS NULL",[exhaustedSession]);
  check(activeExhausted[0].n===1,"exhausted resend creates no new challenge");

  const invertedUser=randomUUID(), invertedSession=randomUUID(), invertedChallenge=randomUUID();
  await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[invertedUser]);
  await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[invertedSession,invertedUser]);
  check(await reserve(invertedSession,invertedChallenge,digest,"ip-inverted",false,invertedUser)==="RESERVED","inverted clock fixture reserved");
  check(await finalize(invertedSession,invertedChallenge,true,invertedUser),"inverted clock fixture delivered");
  const holder=await pool.connect();
  let revokeStarted;
  try {
    await holder.query("BEGIN");
    await holder.query("SET LOCAL ROLE service_role");
    await holder.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,729401))",[invertedSession]);
    revokeStarted=actorRpc(pool,"service_role","ogh_revoke_verified_session",[invertedUser,invertedSession]);
    let waiting=false;
    for(let n=0;n<100;n++) {
      const rows=await query(client,"SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ogh_revoke_verified_session%' AND pid<>pg_backend_pid()");
      if(rows.length) { waiting=true; break; }
      await new Promise((resolve)=>setTimeout(resolve,20));
    }
    check(waiting,"revocation captured entry clock then waited for session lock");
    check(await rpc(holder,"ogh_consume_login_challenge",[invertedUser,invertedSession,invertedChallenge,digest])==="VERIFIED","consume commits after revocation entered");
    await holder.query("COMMIT");
    check(await revokeStarted,"waiting revocation succeeds after later verification");
  } finally {
    if(holder) { await holder.query("ROLLBACK"); holder.release(); }
    if(revokeStarted) await revokeStarted.catch(()=>{});
  }
  const invertedRow=await query(client,"SELECT verified_at,revoked_at FROM private.ogh_verified_sessions WHERE session_id=$1",[invertedSession]);
  check(invertedRow[0].revoked_at>=invertedRow[0].verified_at,"serialized revocation timestamp satisfies constraint");
  check(!(await predicate(client,{user:invertedUser,session:invertedSession})),"inverted clock session ends revoked");

  const utcDay=(await query(client,"SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS day"))[0].day;
  await client.query("INSERT INTO private.ogh_email_send_budget(utc_day,scope,scope_key,send_count) VALUES($1::date-1,'user',$2,5)",[utcDay,quotaUser]);
  check(await reserve(quotaSession,randomUUID(),digest,"ip-day",false,quotaUser)==="RESERVED","prior UTC day budget does not block today");
  const ipUsers=Array.from({length:2},()=>randomUUID()), ipSessions=Array.from({length:2},()=>randomUUID());
  for(let i=0;i<2;i++) {
    await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[ipUsers[i]]);
    await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[ipSessions[i],ipUsers[i]]);
  }
  await client.query("INSERT INTO private.ogh_email_send_budget(utc_day,scope,scope_key,send_count) VALUES($1,'ip_hash','ip-capped',9)",[utcDay]);
  const ipRace=await Promise.all(ipSessions.map((s,i)=>reserve(s,randomUUID(),digest,"ip-capped",false,ipUsers[i])));
  check(ipRace.filter((v)=>v==="RESERVED").length===1 && ipRace.includes("EMAIL_BUDGET_EXHAUSTED"),"IP budget race capped at ten");
  const globalBefore=(await query(client,"SELECT send_count FROM private.ogh_email_send_budget WHERE utc_day=$1 AND scope='global' AND scope_key='all'",[utcDay]))[0].send_count;
  await client.query("UPDATE private.ogh_email_send_budget SET send_count=99 WHERE utc_day=$1 AND scope='global' AND scope_key='all'",[utcDay]);
  const globalUsers=Array.from({length:2},()=>randomUUID()), globalSessions=Array.from({length:2},()=>randomUUID());
  for(let i=0;i<2;i++) {
    await client.query("INSERT INTO auth.users(id,aud,role) VALUES($1,'authenticated','authenticated')",[globalUsers[i]]);
    await client.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",[globalSessions[i],globalUsers[i]]);
  }
  const globalRace=await Promise.all(globalSessions.map((s,i)=>reserve(s,randomUUID(),digest,"ip-global",false,globalUsers[i])));
  check(globalRace.filter((v)=>v==="RESERVED").length===1 && globalRace.includes("EMAIL_BUDGET_EXHAUSTED"),"global budget race capped at one hundred");
  const globalAfter=(await query(client,"SELECT send_count FROM private.ogh_email_send_budget WHERE utc_day=$1 AND scope='global' AND scope_key='all'",[utcDay]))[0].send_count;
  check(globalAfter===100 && globalBefore<100,"global count cannot exceed 100");
  await client.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])",[[...extraUsers,...ipUsers,...globalUsers,pendingUser,exhaustedUser,invertedUser]]);
  await client.query("DELETE FROM auth.users WHERE id IN ($1,$2)",[user,other]);
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
  pool = new pg.Pool({ connectionString: status.DB_URL, max: 12 });
  const client = await pool.connect();
  try {
    if (!process.argv.includes("--bypass-only")) { await verify(client); await verifyTask3(client, pool); }
    await verifyBypass({ pool, status });
  } finally { client.release(); }
  if (!process.argv.includes("--bypass-only")) console.log(`PASS verified session SQL: ${checks} assertions; disposable local Supabase; four-table migration replay`);
} finally {
  await pool?.end();
  if (started) await run(process.execPath, [cli, "stop", "--no-backup", "--workdir", ownedRoot], ownedRoot);
  if (ownedRoot && path.dirname(ownedRoot) === os.tmpdir() && path.basename(ownedRoot).startsWith(`ogh-verified-sql-${id}-`)) await rm(ownedRoot, { recursive: true, force: true });
}
