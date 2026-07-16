// LOCAL_R5L_ONLY
// NO_CLOUD_CONTACT
// NO_PRODUCTION_TARGETS
// DISPOSABLE_FIXTURES_ONLY
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  R5L_LOCAL_ONLY_MARKERS,
  startBuiltPagesWorker,
  waitForWorkerResponse,
} from "./lib/r5l-pages-multimodule-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedHead = "d123cb47bc34aa9579aa9918d9a94401de9cbfbd";
const expectedProposalHash = "10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb";
const proposalPath = path.join(root, "docs", "ops", "reconciliation", "operational-guardrails-rate-limit-r2-unexecuted-proposal.sql");
const reportPath = path.join(root, ".r5l-local-report.json");
const localPrefix = "local-supabase-normalized-replay-";

export const R5L_STAGE_IDS = [
  "repository-integrity", "local-target", "mirror-start", "schema-readiness", "r2-fingerprint",
  "r2-install", "r2-postflight", "fixtures", "build", "worker-start", "worker-readiness",
  "auth-readiness", "http-post-matrix", "http-comment-matrix", "http-circle-matrix", "http-media-matrix", "http-external-video-matrix", "fault-injection", "http-concurrency", "security-audit", "regression-gates",
  "fixture-cleanup", "r2-removal", "worker-shutdown", "mirror-shutdown", "residue-check", "report",
];

function command(command, args, { input, allowFailure = false } = {}) {
  const result = execFileSync(command, args, { cwd: root, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
  return result.trim();
}

function docker(args, options) { return command("docker", args, options); }

function envValue(container, name) {
  const lines = docker(["inspect", container, "--format", "{{range .Config.Env}}{{println .}}{{end}}"])
    .split(/\r?\n/);
  const prefix = `${name}=`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`R5L local container is missing ${name}`);
  return line.slice(prefix.length);
}

function localContainers({ runningOnly = false } = {}) {
  const args = ["ps", ...(runningOnly ? [] : ["-a"]), "--format", "{{.Names}}"];
  return docker(args).split(/\r?\n/).filter((name) => name.includes(localPrefix));
}

function requiredContainer(kind, runningOnly = true) {
  const matches = localContainers({ runningOnly }).filter((name) => name.startsWith(`supabase_${kind}_`));
  if (matches.length !== 1) throw new Error(`R5L expected exactly one local ${kind} container`);
  return matches[0];
}

function psql(database, sql) {
  return docker(["exec", "-i", database, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql });
}

async function waitForDatabase(database) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      psql(database, "SELECT 1;");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("R5L normalized local database did not become ready");
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function base64url(value) { return Buffer.from(value).toString("base64url"); }

export function createLocalAccessToken({ userId, email, jwtSecret, audience = "authenticated", issuer = "supabase" }) {
  assert.match(userId, /^[0-9a-f-]{36}$/i, "local fixture user id must be a UUID");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ sub: userId, role: "authenticated", aud: audience, iss: issuer, email, iat: now, exp: now + 300 }));
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
}

function createLocalServiceToken({ role, jwtSecret, audience, issuer }) {
  assert.ok(["anon", "service_role"].includes(role), "local service token role is invalid");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ role, aud: audience, iss: issuer, iat: now, exp: now + 300 }));
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
}

export function buildLocalBindings({ anonKey, serviceRoleKey, rateLimitSalt }) {
  return {
    ...Object.fromEntries(R5L_LOCAL_ONLY_MARKERS.map((marker) => [marker, "true"])),
    SUPABASE_URL: "http://127.0.0.1:54321",
    PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: anonKey,
    PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    RATE_LIMIT_SALT: rateLimitSalt,
    SENSITIVE_LEXICON_DISABLE_NODE_LOCAL: "true",
    DEV_TURNSTILE_BYPASS: "true",
    OPENAI_MODERATION_ENABLED: "false",
    R2_ACCOUNT_ID: "local-r5l-account",
    R2_ACCESS_KEY_ID: "local-r5l-access",
    R2_SECRET_ACCESS_KEY: "local-r5l-secret",
    R2_BUCKET_NAME: "local-r5l-bucket",
    R2_PUBLIC_BASE_URL: "http://127.0.0.1:8788/r5l-media",
  };
}

export async function postJson(origin, pathname, { token, body, ip = "127.0.0.2" } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export function createStageRecorder() {
  const stages = [];
  return {
    stages,
    async run(id, callback) {
      const started = Date.now();
      const entry = { id, status: "STARTED", elapsedMs: 0 };
      stages.push(entry);
      try {
        const value = await callback();
        entry.status = "PASS";
        entry.elapsedMs = Date.now() - started;
        return value;
      } catch (error) {
        entry.status = "FAIL";
        entry.elapsedMs = Date.now() - started;
        entry.classification = "LOCAL_STAGE_FAILURE";
        throw error;
      }
    },
  };
}

function safeJson(response) {
  if (/service_role|postgres|supabase|uuid|[0-9a-f]{8}-[0-9a-f-]{27}/i.test(response.body)) throw new Error("R5L public response leaked internal material");
  return response.body;
}

function responseJson(response, label) {
  try { return JSON.parse(response.body); } catch { throw new Error(`R5L ${label} returned invalid JSON`); }
}

function tableCount(database, table, where = "true") {
  return Number.parseInt(psql(database, `SELECT count(*) FROM public.${table} WHERE ${where};`), 10);
}

function fixtureSql(fixture) {
  const users = [fixture.userA, fixture.userB];
  return `BEGIN;
${users.map((user) => `INSERT INTO public.profiles (id,username,display_name,role) VALUES (${sqlLiteral(user.id)}::uuid,${sqlLiteral(user.username)},${sqlLiteral(user.username)},'user') ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username;`).join("\n")}
${users.map((user) => `INSERT INTO public.legal_policy_acceptances (user_id,bundle_version,privacy_version,terms_version,guidelines_version,minimum_age,first_acceptance_source,last_confirmation_source,confirmation_count) VALUES (${sqlLiteral(user.id)}::uuid,'2026-07','2026-07','2026-07','2026-07',16,'registration','registration',1);`).join("\n")}
INSERT INTO public.circles (id,slug,name,description,type,owner_id,status) VALUES (${sqlLiteral(fixture.circleId)}::uuid,${sqlLiteral(fixture.circleSlug)},'R5L local circle','Disposable local fixture','topic',${sqlLiteral(fixture.userA.id)}::uuid,'active');
COMMIT;`;
}

async function createLocalAuthFixture({ email, password, anonKey }) {
  const response = await fetch("http://127.0.0.1:54321/auth/v1/signup", {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`R5L local GoTrue fixture creation failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.access_token !== "string" || payload.access_token.split(".").length !== 3 || !/^[0-9a-f-]{36}$/i.test(String(payload?.user?.id ?? ""))) throw new Error("R5L local GoTrue returned an incomplete fixture session");
  return { token: payload.access_token, userId: payload.user.id };
}

async function waitForLocalAuth(anonKey) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:54321/auth/v1/health", { headers: { apikey: anonKey } });
      if (![502, 503, 504].includes(response.status)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("R5L local GoTrue did not become ready");
}

function cleanupSql() {
  return `BEGIN;
DELETE FROM public.forum_upload_attempts WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM public.comments WHERE author_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM public.posts WHERE author_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM public.circles WHERE owner_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM public.legal_policy_acceptances WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'r5l-%@local.test');
DELETE FROM auth.users WHERE email LIKE 'r5l-%@local.test';
COMMIT;
DROP FUNCTION IF EXISTS public.consume_forum_rate_limit(uuid,text,text,bigint);`;
}

async function executeSuite() {
  const recorder = createStageRecorder();
  const runId = randomUUID().replaceAll("-", "");
  let database;
  let worker;
  let mirrorStarted = false;
  const fixture = {
    userA: { id: null, email: `r5l-${runId}-a@local.test`, username: `r5la${runId.slice(0, 10)}`, password: `R5l-${runId}-A` },
    userB: { id: null, email: `r5l-${runId}-b@local.test`, username: `r5lb${runId.slice(0, 10)}`, password: `R5l-${runId}-B` },
    circleId: randomUUID(), circleSlug: `r5l-${runId.slice(0, 12)}`,
  };
  let failure;
  try {
    await recorder.run("repository-integrity", async () => {
      const head = command("git", ["rev-parse", "HEAD"]);
      assert.equal(head, command("git", ["rev-parse", "origin/feature/legal-trust-consent-foundation-v1"]), "R5L origin mismatch");
      command("git", ["merge-base", "--is-ancestor", expectedHead, head]);
      assert.equal(command("git", ["status", "--porcelain"]), "", "R5L worktree must be clean");
    });
    await recorder.run("local-target", async () => {
      const stopped = localContainers();
      assert.equal(stopped.length, 10, "R5L requires the ten-container normalized local mirror");
      assert.equal(localContainers({ runningOnly: true }).length, 0, "R5L requires a stopped fresh mirror");
    });
    await recorder.run("mirror-start", async () => { docker(["start", ...localContainers()]); mirrorStarted = true; database = requiredContainer("db"); await waitForDatabase(database); });
    await recorder.run("schema-readiness", async () => {
      assert.equal(psql(database, "SELECT to_regclass('public.forum_upload_attempts') IS NOT NULL;") , "t");
    });
    await recorder.run("r2-fingerprint", async () => {
      assert.equal(createHash("sha256").update(await readFile(proposalPath)).digest("hex"), expectedProposalHash, "R5L R2 proposal fingerprint mismatch");
    });
    await recorder.run("r2-install", async () => { psql(database, await readFile(proposalPath, "utf8")); });
    await recorder.run("r2-postflight", async () => {
      const row = psql(database, "SELECT prosecdef::text || '|' || provolatile::text || '|' || proparallel::text || '|' || proleakproof::text || '|' || pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.consume_forum_rate_limit(uuid,text,text,bigint)'::regprocedure;");
      assert.equal(row, "true|v|u|false|postgres", "R5L RPC catalog contract mismatch");
    });
    const auth = requiredContainer("auth");
    const jwtSecret = envValue(auth, "GOTRUE_JWT_SECRET");
    const audience = envValue(auth, "GOTRUE_JWT_AUD");
    const issuer = envValue(auth, "GOTRUE_JWT_ISSUER");
    const anonKey = createLocalServiceToken({ role: "anon", jwtSecret, audience, issuer });
    const serviceRoleKey = createLocalServiceToken({ role: "service_role", jwtSecret, audience, issuer });
    let tokenA;
    let tokenB;
    await recorder.run("fixtures", async () => {
      await waitForLocalAuth(anonKey);
      const [authA, authB] = await Promise.all([
        createLocalAuthFixture({ email: fixture.userA.email, password: fixture.userA.password, anonKey }),
        createLocalAuthFixture({ email: fixture.userB.email, password: fixture.userB.password, anonKey }),
      ]);
      fixture.userA.id = authA.userId;
      fixture.userB.id = authB.userId;
      tokenA = authA.token;
      tokenB = authB.token;
      psql(database, fixtureSql(fixture));
    });
    await recorder.run("build", async () => { command(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/c", "npm", "run", "build"] : ["run", "build"]); });
    const port = await availablePort();
    await recorder.run("worker-start", async () => { worker = await startBuiltPagesWorker({ repositoryRoot: root, bindings: buildLocalBindings({ anonKey, serviceRoleKey, rateLimitSalt: `r5l-${runId}` }), port }); });
    await recorder.run("worker-readiness", async () => { assert.equal((await waitForWorkerResponse(worker.origin, { pathname: "/api/forum/search?q=open" })).status, 200); });
    let fixturePostId;
    await recorder.run("auth-readiness", async () => {
      const response = await postJson(worker.origin, "/api/forum/posts", { token: tokenA, body: { circle_slug: fixture.circleSlug, title: "R5L authenticated readiness", body: "local fixture", type: "experience" } });
      assert.equal(response.status, 201, "R5L authenticated post readiness failed");
      fixturePostId = String(responseJson(response, "authenticated readiness").post?.id ?? "");
      assert.match(fixturePostId, /^[0-9a-f-]{36}$/i, "R5L readiness post id is missing");
    });
    await recorder.run("http-post-matrix", async () => {
      const responses = [];
      for (let index = 0; index < 10; index += 1) responses.push(await postJson(worker.origin, "/api/forum/posts", { token: tokenB, ip: "127.0.0.21", body: { circle_slug: fixture.circleSlug, title: `R5L post ${index}`, body: "local fixture", type: "experience" } }));
      assert.deepEqual(responses.map(({ status }) => status), Array(10).fill(201), "R5L first ten posts must be accepted");
      const limited = await postJson(worker.origin, "/api/forum/posts", { token: tokenB, ip: "127.0.0.21", body: { circle_slug: fixture.circleSlug, title: "R5L post limited", body: "local fixture", type: "experience" } });
      assert.equal(limited.status, 429, "R5L eleventh post must be limited");
      safeJson(limited);
    });
    await recorder.run("http-comment-matrix", async () => {
      const before = tableCount(database, "comments", `author_id=${sqlLiteral(fixture.userA.id)}::uuid`);
      const responses = [];
      for (let index = 0; index < 60; index += 1) responses.push(await postJson(worker.origin, "/api/forum/comments", { token: tokenA, ip: "127.0.0.32", body: { post_id: fixturePostId, body: `R5L comment ${index}` } }));
      assert.deepEqual(responses.map(({ status }) => status), Array(60).fill(201), "R5L first sixty comments must be accepted");
      const limited = await postJson(worker.origin, "/api/forum/comments", { token: tokenA, ip: "127.0.0.32", body: { post_id: fixturePostId, body: "R5L comment limited" } });
      assert.equal(limited.status, 429, "R5L sixty-first comment must be limited");
      assert.equal(tableCount(database, "comments", `author_id=${sqlLiteral(fixture.userA.id)}::uuid`) - before, 60, "R5L limited comment continued to write");
      safeJson(limited);
    });
    await recorder.run("http-circle-matrix", async () => {
      const before = tableCount(database, "circles", `owner_id=${sqlLiteral(fixture.userB.id)}::uuid`);
      const responses = [];
      for (let index = 0; index < 5; index += 1) responses.push(await postJson(worker.origin, "/api/forum/circles", { token: tokenB, ip: "127.0.0.33", body: { name: `R5L Circle ${runId.slice(0, 8)} ${index}`, description: "local fixture", type: "topic" } }));
      assert.deepEqual(responses.map(({ status }) => status), Array(5).fill(201), "R5L first five circles must be accepted");
      const limited = await postJson(worker.origin, "/api/forum/circles", { token: tokenB, ip: "127.0.0.33", body: { name: `R5L Circle ${runId.slice(0, 8)} limited`, description: "local fixture", type: "topic" } });
      assert.equal(limited.status, 429, "R5L sixth circle must be limited");
      assert.equal(tableCount(database, "circles", `owner_id=${sqlLiteral(fixture.userB.id)}::uuid`) - before, 5, "R5L limited circle continued to write");
      safeJson(limited);
    });
    await recorder.run("http-media-matrix", async () => {
      const oneByte = await postJson(worker.origin, "/api/forum/media-upload-guard", { token: tokenA, ip: "127.0.0.31", body: { upload_kind: "post_media", size_bytes: 1 } });
      const invalid = await postJson(worker.origin, "/api/forum/media-upload-guard", { token: tokenA, ip: "127.0.0.31", body: { upload_kind: "post_media", size_bytes: 157286401 } });
      assert.equal(oneByte.status, 200, "R5L one-byte media reservation failed");
      assert.equal(invalid.status, 400, "R5L oversized media must fail before protected action");
    });
    await recorder.run("http-external-video-matrix", async () => {
      const video = (size) => ({ post_id: fixturePostId, file_name: "r5l-video.mp4", mime_type: "video/mp4", size_bytes: size });
      const responses = [];
      for (let index = 0; index < 10; index += 1) responses.push(await postJson(worker.origin, "/api/forum/external-video-upload", { token: tokenA, ip: "127.0.0.41", body: video(1) }));
      assert.deepEqual(responses.map(({ status }) => status), Array(10).fill(200), "R5L first ten external-video reservations must sign locally");
      const limited = await postJson(worker.origin, "/api/forum/external-video-upload", { token: tokenA, ip: "127.0.0.41", body: video(1) });
      const oversized = await postJson(worker.origin, "/api/forum/external-video-upload", { token: tokenA, ip: "127.0.0.42", body: video(157286401) });
      assert.equal(limited.status, 429, "R5L eleventh external-video reservation must be limited");
      assert.equal(oversized.status, 400, "R5L oversized external video must stop before reservation");
      safeJson(limited);
    });
    await recorder.run("fault-injection", async () => {
      psql(database, "DROP FUNCTION public.consume_forum_rate_limit(uuid,text,text,bigint);");
      const before = tableCount(database, "forum_upload_attempts");
      const failed = await postJson(worker.origin, "/api/forum/media-upload-guard", { token: tokenA, ip: "127.0.0.51", body: { upload_kind: "post_media", size_bytes: 1 } });
      assert.equal(failed.status, 503, "R5L missing RPC must fail closed");
      assert.equal(tableCount(database, "forum_upload_attempts"), before, "R5L missing RPC continued protected action");
      safeJson(failed);
      psql(database, await readFile(proposalPath, "utf8"));
      psql(database, "REVOKE EXECUTE ON FUNCTION public.consume_forum_rate_limit(uuid,text,text,bigint) FROM service_role;");
      const revoked = await postJson(worker.origin, "/api/forum/media-upload-guard", { token: tokenA, ip: "127.0.0.51", body: { upload_kind: "post_media", size_bytes: 1 } });
      assert.equal(revoked.status, 503, "R5L revoked service-role execute must fail closed");
      assert.equal(tableCount(database, "forum_upload_attempts"), before, "R5L revoked execute continued protected action");
      safeJson(revoked);
      psql(database, "GRANT EXECUTE ON FUNCTION public.consume_forum_rate_limit(uuid,text,text,bigint) TO service_role;");
      const missingBinding = buildLocalBindings({ anonKey, serviceRoleKey, rateLimitSalt: `r5l-${runId}-missing-binding` });
      delete missingBinding.SUPABASE_SERVICE_ROLE_KEY;
      missingBinding.R5L_ALLOW_MISSING_SERVICE_ROLE_FOR_FAULT = "true";
      const faultWorker = await startBuiltPagesWorker({ repositoryRoot: root, bindings: missingBinding, port: await availablePort() });
      try {
        const bindingFailure = await postJson(faultWorker.origin, "/api/forum/media-upload-guard", { token: tokenA, ip: "127.0.0.51", body: { upload_kind: "post_media", size_bytes: 1 } });
        assert.equal(bindingFailure.status, 503, "R5L missing service binding must fail closed");
        assert.equal(tableCount(database, "forum_upload_attempts"), before, "R5L missing binding continued protected action");
        safeJson(bindingFailure);
      } finally {
        await faultWorker.dispose();
      }
    });
    await recorder.run("http-concurrency", async () => {
      const seedUser = fixture.userA.id;
      const ipHash = "a".repeat(64);
      psql(database, `INSERT INTO public.forum_upload_attempts (user_id,ip_hash,bytes,purpose) SELECT ${sqlLiteral(seedUser)}::uuid,${sqlLiteral(ipHash)},0,'post_create' FROM generate_series(1,8);`);
      const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => postJson(worker.origin, "/api/forum/posts", { token: tokenA, ip: "127.0.0.52", body: { circle_slug: fixture.circleSlug, title: `R5L concurrent ${index}`, body: "local fixture", type: "experience" } })));
      const statuses = responses.map(({ status }) => status).sort((left, right) => left - right);
      assert.deepEqual(statuses, [201, 429, 429, 429, 429], "R5L one-slot concurrent post contract failed");
    });
    await recorder.run("security-audit", async () => {
      const assets = await readFile(path.join(root, "dist", "_worker.js", "index.js"), "utf8");
      assert.doesNotMatch(assets, /SUPABASE_SERVICE_ROLE_KEY/, "R5L Worker asset contains a service role binding name");
    });
    await recorder.run("regression-gates", async () => {
      command(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/c", "npm", "run", "test:r5l-pages-harness"] : ["run", "test:r5l-pages-harness"]);
      command(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/c", "npm", "run", "test:external-video-authorization-ordering"] : ["run", "test:external-video-authorization-ordering"]);
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "R5L local failure";
  } finally {
    const cleanup = async (id, callback) => { try { await recorder.run(id, callback); } catch (error) { failure ??= "R5L cleanup failed"; } };
    await cleanup("fixture-cleanup", async () => { if (database) psql(database, cleanupSql()); });
    await cleanup("r2-removal", async () => { if (database) psql(database, "DROP FUNCTION IF EXISTS public.consume_forum_rate_limit(uuid,text,text,bigint);"); });
    await cleanup("worker-shutdown", async () => { if (worker) await worker.dispose(); });
    await cleanup("mirror-shutdown", async () => { if (mirrorStarted) docker(["stop", ...localContainers({ runningOnly: true })]); });
    await cleanup("residue-check", async () => {
      if (database && localContainers({ runningOnly: true }).includes(database)) throw new Error("R5L local stack did not stop");
      assert.equal(localContainers({ runningOnly: true }).length, 0, "R5L mirror residue remains running");
    });
  }
  const report = { classification: failure ? "R5L_BLOCKED_HTTP_BEHAVIOR" : "R5L_BLOCKED_FAULT_INJECTION", localBaseline: "NORMALIZED_LOCAL_MIGRATION_MIRROR", stages: recorder.stages, r2ProposalSha256: expectedProposalHash };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await rm(reportPath, { force: true });
  if (failure) throw new Error(`R5L local suite failed: ${failure}`);
  console.log(JSON.stringify(report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  executeSuite().catch((error) => { console.error(error instanceof Error ? error.message : "R5L local suite failed"); process.exitCode = 1; });
}
