import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { buildLocalSupabaseReplayMirror, ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = {}", shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.(?:ts|tsx|js|mjs|json)$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const { handleSignupConfirm } = await import("../src/pages/api/auth/signup-confirm.ts");
const { POST: resendConfirmation } = await import("../src/pages/api/auth/resend-confirmation.ts");
const { LEGAL_POLICY } = await import("../src/lib/legal-policy.ts");
const versions = {
  bundle: LEGAL_POLICY.bundleVersion, terms: LEGAL_POLICY.termsVersion,
  privacy: LEGAL_POLICY.privacyVersion, guidelines: LEGAL_POLICY.guidelinesVersion,
};
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const email = "signup@example.test";
const secret = "signup-local-test-secret";
const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const claims = { iss: `${env.SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated", sub: userId,
  session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false, amr: [{ method: "otp" }] };
const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
const token = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const accepted = { email, code: "123456", acceptedPolicies: true, policyVersions: versions };

async function run(payload, { provider = true, user = true, policy = true, activation = true, returnedUser = userId } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === "/auth/v1/verify") return provider ? json({ access_token: token, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, user: { id: returnedUser, email, email_confirmed_at: "2026-09-23T00:00:00Z" } }) : json({ message: "invalid" }, 403);
    if (path === "/auth/v1/user") return user ? json({ id: userId, email, email_confirmed_at: "2026-09-23T00:00:00Z" }) : json({ id: sessionId, email });
    if (path === "/rest/v1/rpc/ogh_record_policy_acceptance") return policy ? json(null) : json({ message: "failure" }, 500);
    if (path === "/rest/v1/rpc/ogh_activate_signup_session") return activation ? json(true) : json(false);
    throw Error(`unexpected ${path}`);
  };
  try {
    const response = await handleSignupConfirm(new Request("https://app.test/api/auth/signup-confirm", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(payload),
    }), env);
    return { response, data: await response.json(), calls };
  } finally { globalThis.fetch = previous; }
}

for (const payload of [
  { email, code: "123456" }, { ...accepted, acceptedPolicies: false },
  { ...accepted, policyVersions: { ...versions, terms: "old" } },
  { ...accepted, policyVersions: { ...versions, privacy: "old" } },
  { ...accepted, policyVersions: { ...versions, guidelines: "old" } },
  { ...accepted, policyVersions: { ...versions, bundle: "old" } },
  { ...accepted, type: "email" },
]) {
  const result = await run(payload);
  assert.notEqual(result.response.status, 200);
  assert.equal(result.calls.length, 0, "invalid declaration must have no provider or database effects");
}
const success = await run(accepted);
assert.equal(success.response.status, 200);
assert.deepEqual(success.data, { access_token: token, refresh_token: "refresh" });
assert.equal(success.response.headers.get("cache-control"), "no-store");
assert.deepEqual(success.calls.map((call) => call.path), [
  "/auth/v1/verify", "/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_record_policy_acceptance", "/rest/v1/rpc/ogh_activate_signup_session",
]);
assert.equal(success.calls[0].body.type, "signup");
assert.deepEqual(success.calls.at(-2).body, {
  p_user_id: userId, p_bundle: versions.bundle, p_terms: versions.terms,
  p_privacy: versions.privacy, p_guidelines: versions.guidelines, p_source: "registration",
});
assert.deepEqual(success.calls.at(-1).body, { p_user_id: userId, p_session_id: sessionId });
for (const options of [{ provider: false }, { user: false }, { returnedUser: sessionId }, { policy: false }, { activation: false }]) {
  const result = await run(accepted, options);
  assert.notEqual(result.response.status, 200);
  assert.equal(result.data.access_token, undefined);
  if (options.policy === false || options.user === false || options.provider === false || options.returnedUser) assert.ok(!result.calls.some((call) => call.path.endsWith("ogh_activate_signup_session")));
}
console.log("PASS signup confirmation request boundary");
const resendWithSelectedType = await resendConfirmation({ request: new Request("https://app.test/api/auth/resend-confirmation", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, next: "/", type: "email" }),
}) });
assert.equal(resendWithSelectedType.status, 400, "resend rejects client-selected OTP type before provider access");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules/supabase/dist/supabase.js");
const ownedId = Math.random().toString(16).slice(2, 10);
const projectId = `ogh-signup-${ownedId}`;
const cleanEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|systemroot|windir|temp|tmp|comspec|pathext|appdata|localappdata|userprofile)$/i.test(key))),
  SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "", SUPABASE_DB_URL: "" });
function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: cleanEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`local CLI ${args[0]} exited ${code}: ${output.slice(-2500)}`)));
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function latestCode(mailUrl, recipient, previous = "") {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const list = await fetch(`${mailUrl}/api/v1/messages`).then((response) => response.json());
    for (const item of list.messages ?? []) {
      if (!JSON.stringify(item.To ?? item.to ?? "").toLowerCase().includes(recipient.toLowerCase())) continue;
      const message = await fetch(`${mailUrl}/api/v1/message/${item.ID ?? item.id}`).then((response) => response.json());
      const code = /\b\d{6}\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[0];
      if (code && code !== previous) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`local mail code unavailable for ${recipient}`);
}

let ownedRoot;
let started = false;
let pool;
try {
  ownedRoot = await mkdtemp(path.join(os.tmpdir(), `${projectId}-`));
  assert.equal(path.dirname(ownedRoot), os.tmpdir());
  await runCli(["init", "--yes", "--workdir", ownedRoot], ownedRoot);
  const configPath = path.join(ownedRoot, "supabase/config.toml");
  let config = await readFile(configPath, "utf8");
  config = config.replace(/^project_id = "[^"]+"/m, `project_id = "${projectId}"`);
  for (const section of ["api", "db", "studio", "local_smtp", "analytics", "db.pooler", "edge_runtime"]) {
    const match = config.match(new RegExp(`\\[${section.replaceAll(".", "\\.")}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    if (!match) throw new Error(`missing local config ${section}`);
    const key = section === "db" ? "port" : section === "edge_runtime" ? "inspector_port" : "port";
    config = config.replace(match[0], match[0].replace(new RegExp(`(^${key}\\s*=\\s*)\\d+`, "m"), `$1${await freePort()}`));
  }
  config = config.replace(/(\[db\][\s\S]*?\nshadow_port\s*=\s*)\d+/, `$1${await freePort()}`);
  config = config.replace(/(\[auth\.email\]\s*[\s\S]*?enable_confirmations\s*=\s*)false/, "$1true");
  config = config.replace(/(\[auth\.email\]\s*[\s\S]*?max_frequency\s*=\s*)"[^"]+"/, '$1"1s"');
  for (const template of ["confirmation", "magic_link", "recovery", "email_change"]) {
    config += `\n[auth.email.template.${template}]\nsubject = "Local code"\ncontent_path = "./supabase/templates/${template}.html"\n`;
  }
  await writeFile(configPath, config);
  await mkdir(path.join(ownedRoot, "supabase/templates"));
  for (const template of ["confirmation", "magic_link", "recovery", "email_change"]) {
    await writeFile(path.join(ownedRoot, `supabase/templates/${template}.html`), "<p>{{ .Token }}</p><p>{{ .ConfirmationURL }}</p>");
  }
  const historical = path.join(ownedRoot, "historical-migrations");
  await mkdir(historical);
  for (const filename of ORDERED_MIGRATION_FILENAMES) {
    const bytes = execFileSync("git", ["-C", root, "cat-file", "blob", `HEAD:supabase/migrations/${filename}`]);
    await writeFile(path.join(historical, filename), bytes);
  }
  await buildLocalSupabaseReplayMirror({ canonicalDirectory: historical, outputDirectory: path.join(ownedRoot, "supabase/migrations"), mappingPath: path.join(ownedRoot, "mapping.json"), repositoryRoot: root });
  const files = await readdir(path.join(ownedRoot, "supabase/migrations"));
  const next = String(BigInt(files.sort().at(-1).slice(0, 14)) + 1n);
  await cp(path.join(root, "supabase/migrations/20260923000000_ogh_verified_session_v1.sql"), path.join(ownedRoot, "supabase/migrations", `${next}_ogh_verified_session_v1.sql`));
  started = true;
  await runCli(["start", "--workdir", ownedRoot], ownedRoot);
  const statusOutput = await runCli(["status", "--output", "json", "--workdir", ownedRoot], ownedRoot);
  const status = JSON.parse(statusOutput.slice(statusOutput.indexOf("{"), statusOutput.lastIndexOf("}") + 1));
  for (const url of [status.API_URL, status.DB_URL, status.INBUCKET_URL]) assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  pool = new pg.Pool({ connectionString: status.DB_URL });
  const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const localEmail = `${ownedId}@example.test`;
  const { error: signupError } = await anon.auth.signUp({ email: localEmail, password: "LocalOnlyPassword123!" });
  assert.equal(signupError, null);
  const first = await latestCode(status.INBUCKET_URL, localEmail);
  const liveEnv = { SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
  async function confirm(code, target = localEmail, declaration = true) {
    return handleSignupConfirm(new Request("http://127.0.0.1/api/auth/signup-confirm", {
      method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ email: target, code, acceptedPolicies: declaration, policyVersions: versions }),
    }), liveEnv);
  }
  assert.notEqual((await confirm(first, localEmail, false)).status, 200);
  const result = await confirm(first);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  const session = await result.json();
  const { data: identity } = await anon.auth.getUser(session.access_token);
  const sessionClaims = await anon.auth.getClaims(session.access_token);
  assert.equal(identity.user.email, localEmail);
  const query = await pool.query("SELECT verification_kind FROM private.ogh_verified_sessions WHERE session_id=$1", [sessionClaims.data.claims.session_id]);
  assert.equal(query.rows[0]?.verification_kind, "signup");
  const acceptance = await pool.query("SELECT bundle_version,terms_version,privacy_version,guidelines_version,acceptance_source FROM private.ogh_policy_acceptances WHERE user_id=$1", [identity.user.id]);
  assert.deepEqual(acceptance.rows[0], {
    bundle_version: versions.bundle, terms_version: versions.terms, privacy_version: versions.privacy,
    guidelines_version: versions.guidelines, acceptance_source: "registration",
  });
  assert.notEqual((await confirm(first)).status, 200, "replay denied");
  const otherEmail = `${ownedId}-other@example.test`;
  assert.equal((await anon.auth.signUp({ email: otherEmail, password: "LocalOnlyPassword123!" })).error, null);
  const oldCode = await latestCode(status.INBUCKET_URL, otherEmail);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await anon.auth.resend({ type: "signup", email: otherEmail })).error, null);
  const newCode = await latestCode(status.INBUCKET_URL, otherEmail, oldCode);
  assert.notEqual((await confirm(oldCode, otherEmail)).status, 200, "superseded signup code denied");
  assert.notEqual((await confirm(newCode, localEmail)).status, 200, "cross-email signup code denied");
  assert.equal((await confirm(newCode, otherEmail)).status, 200, "resent signup code accepted");

  assert.equal((await anon.auth.signInWithOtp({ email: localEmail, options: { shouldCreateUser: false } })).error, null);
  const genericCode = await latestCode(status.INBUCKET_URL, localEmail, first);
  assert.notEqual((await confirm(genericCode)).status, 200, "generic email OTP cannot activate signup");
  const genericExchange = await anon.auth.verifyOtp({ email: localEmail, token: genericCode, type: "email" });
  assert.equal(genericExchange.error, null, "generic artifact is valid for email OTP");
  assert.notEqual((await confirm(genericCode)).status, 200, "email OTP exchange is not signup provenance");

  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await anon.auth.resetPasswordForEmail(localEmail)).error, null);
  const recoveryCode = await latestCode(status.INBUCKET_URL, localEmail, genericCode);
  assert.notEqual((await confirm(recoveryCode)).status, 200, "recovery artifact denied");
  assert.equal((await anon.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })).error, null);
  const changedEmail = `${ownedId}-changed@example.test`;
  assert.equal((await anon.auth.updateUser({ email: changedEmail })).error, null);
  const changeCode = await latestCode(status.INBUCKET_URL, changedEmail);
  assert.notEqual((await confirm(changeCode, changedEmail)).status, 200, "email-change artifact denied");
  assert.notEqual((await confirm("000000", localEmail)).status, 200, "non-signup code denied");
  console.log("PASS genuine local signup, replay, resend, supersession, cross-email, generic OTP, recovery and email-change denial");
} finally {
  if (pool) await pool.end();
  if (started && ownedRoot) await runCli(["stop", "--no-backup", "--workdir", ownedRoot], ownedRoot);
  if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
}
