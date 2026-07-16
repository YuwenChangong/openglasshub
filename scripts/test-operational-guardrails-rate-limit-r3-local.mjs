import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import {
  PINNED_PSQL_DIGEST,
  PINNED_PSQL_IMAGE,
} from "./lib/docker-psql-file-transport.mjs";

const root = process.cwd();
const proposalPath = "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-unexecuted-proposal.sql";
const postflightPath = "docs/ops/reconciliation/operational-guardrails-rate-limit-r2-static-postflight.sql";
const expectedProposalSha256 = "10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb";
const container = `openglass-r3-rate-limit-${process.pid}-${randomUUID().replaceAll("-", "")}`;
const database = `openglass_r3_${randomUUID().replaceAll("-", "")}`;
const users = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
  "00000000-0000-0000-0000-000000000004",
];
const ip = (label) => Buffer.from(String(label), "utf8").toString("hex").repeat(64).slice(0, 64);
const literal = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker exited ${result.status}`);
  return result.stdout.trim();
}

function psql(sql, { role, allowFailure = false, sessionStatements = [] } = {}) {
  const prefix = [...sessionStatements, ...(role ? [`SET ROLE ${role};`] : [])].join("\n");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], {
    input: `${prefix}${sql}`,
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
    const logTail = [logs.stdout, logs.stderr]
      .filter(Boolean)
      .join("\n")
      .split(/\r?\n/)
      .slice(-40)
      .join("\n");
    throw new Error([result.stderr || result.stdout || "local PostgreSQL command failed", logTail].filter(Boolean).join("\n"));
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psqlAsync(sql, { role } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(`${role ? `SET ROLE ${role};\n` : ""}${sql}`);
  });
}

function hasDecision(result, allowed, decision) {
  const [allowedText, decisionText] = result.stdout.split("\t");
  return result.status === 0 && (allowed ? allowedText === "t" || allowedText === "true" : allowedText === "f" || allowedText === "false") && decisionText === decision;
}

function call({ user = users[0], hash = ip("a"), purpose = "post_create", bytes = 0, role = "service_role", expressions, sessionStatements } = {}) {
  const values = expressions ?? [`${literal(user)}::uuid`, literal(hash), literal(purpose), `${bytes}::bigint`];
  const result = psql(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${values.join(", ")});`, { role, allowFailure: true, sessionStatements });
  if (result.status !== 0) return { error: result.stderr || result.stdout };
  const columns = result.stdout.split("\t");
  assert.equal(columns.length, 2, "rate-limit RPC returns only allowed and decision");
  assert.ok(["ALLOWED", "RATE_LIMITED"].includes(columns[1]), "rate-limit RPC decision must be approved");
  return { allowed: columns[0] === "t" || columns[0] === "true", decision: columns[1], columns };
}

function expectAllowed(input, message) {
  const result = call(input);
  assert.equal(result.allowed, true, `${message}: ${result.error ?? JSON.stringify(result)}`);
  assert.equal(result.decision, "ALLOWED", message);
}

function expectLimited(input, message) {
  const result = call(input);
  assert.equal(result.allowed, false, `${message}: ${result.error ?? JSON.stringify(result)}`);
  assert.equal(result.decision, "RATE_LIMITED", message);
}

function expectError(input, pattern, message) {
  const result = call(input);
  assert.ok(result.error, message);
  assert.match(result.error, pattern, message);
}

function resetAttempts() {
  psql("TRUNCATE public.forum_upload_attempts;");
}

function countAttempts(where = "true") {
  return Number.parseInt(psql(`SELECT count(*) FROM public.forum_upload_attempts WHERE ${where};`).stdout, 10);
}

function byteSum(where = "true") {
  return BigInt(psql(`SELECT coalesce(sum(bytes), 0) FROM public.forum_upload_attempts WHERE ${where};`).stdout);
}

async function waitForReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
    const finalServerStarted = `${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete; ready for start up.");
    const result = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"], { encoding: "utf8" });
    if (finalServerStarted && result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("R3 disposable PostgreSQL container did not reach its final ready state");
}

async function holderSession(lockMaterial) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const locked = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("LOCKED")) resolve();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      if (!stdout.includes("LOCKED")) reject(new Error(stderr || `lock holder exited ${status}`));
    });
  });
  const completed = new Promise((resolve, reject) => {
    child.on("close", (status) => status === 0 ? resolve() : reject(new Error(stderr || `lock holder exited ${status}`)));
  });
  child.stdin.write(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${literal(lockMaterial)}, 0));\n\\echo LOCKED\n`);
  await locked;
  return { completed, release: () => child.stdin.end("COMMIT;\n") };
}

const proposal = await readFile(proposalPath, "utf8");
const postflight = await readFile(postflightPath, "utf8");
const proposalHash = (await import("node:crypto")).createHash("sha256").update(proposal, "utf8").digest("hex");
assert.equal(proposalHash, expectedProposalSha256, "R3 must execute the reviewed R2 proposal bytes");
assert.match(proposal, /UNEXECUTED[\s\S]*NOT A CANONICAL MIGRATION[\s\S]*DO NOT RUN/s);
assert.doesNotMatch(proposal, /https?:\/\/|supabase\.co|cloudflare|postgresql:\/\//i, "proposal must not contain an external target");

const imageDigests = JSON.parse(docker(["image", "inspect", PINNED_PSQL_IMAGE, "--format", "{{json .RepoDigests}}"]));
assert.ok(imageDigests.some((entry) => entry.endsWith(`@${PINNED_PSQL_DIGEST}`)), "pinned local PostgreSQL image digest mismatch");

let containerStarted = false;
let cleanupVerified = false;
let localRowCount = 0;
try {
  docker([
    "run", "-d", "--name", container, "--network", "none",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=128m",
    PINNED_PSQL_IMAGE,
  ]);
  containerStarted = true;
  await waitForReady();
  docker(["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${database};`]);

  const isolation = JSON.parse(docker(["inspect", container, "--format", "{{json .HostConfig}}"]));
  assert.equal(isolation.NetworkMode, "none", "R3 container must have no Docker network");
  assert.deepEqual(isolation.PortBindings, {}, "R3 container must not publish a listener");
  assert.equal(isolation.Tmpfs["/var/lib/postgresql/data"], "rw,noexec,nosuid,size=128m", "R3 data must be tmpfs-backed");

  psql(`
    -- LOCAL_DISPOSABLE_TEST_ONLY
    -- NOT A CANONICAL MIGRATION
    -- NOT FOR PRODUCTION
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'r3_public_probe') THEN CREATE ROLE r3_public_probe NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.forum_upload_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      ip_hash text NOT NULL,
      bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
      purpose text NOT NULL CHECK (purpose IN ('post_media_upload', 'external_video_upload', 'post_create', 'comment_create', 'circle_create', 'verification_email_resend')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX forum_upload_attempts_created_at_idx ON public.forum_upload_attempts (created_at DESC);
    CREATE INDEX forum_upload_attempts_ip_hash_idx ON public.forum_upload_attempts (ip_hash, created_at DESC);
    CREATE INDEX forum_upload_attempts_user_id_idx ON public.forum_upload_attempts (user_id, created_at DESC);
    CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts (purpose, user_id, created_at DESC);
    CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts (purpose, ip_hash, created_at DESC);
    ALTER TABLE public.forum_upload_attempts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY forum_upload_attempts_insert_authenticated ON public.forum_upload_attempts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
    CREATE POLICY forum_upload_attempts_select_authenticated ON public.forum_upload_attempts FOR SELECT TO authenticated USING (true);
    CREATE POLICY forum_upload_attempts_insert_self ON public.forum_upload_attempts FOR INSERT TO authenticated WITH CHECK (((purpose = ANY (ARRAY['post_create'::text, 'comment_create'::text, 'circle_create'::text])) AND user_id = auth.uid()) OR ((purpose = ANY (ARRAY['post_media_upload'::text, 'external_video_upload'::text])) AND (user_id = auth.uid() OR user_id IS NULL)));
    CREATE POLICY forum_upload_attempts_select_self ON public.forum_upload_attempts FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR user_id IS NULL);
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, r3_public_probe;
    REVOKE ALL ON public.forum_upload_attempts FROM PUBLIC, anon, authenticated, service_role, r3_public_probe;
    INSERT INTO auth.users (id) VALUES ${users.map((user) => `(${literal(user)}::uuid)`).join(", ")};
  `);
  const baselinePolicies = countAttempts("false") + Number.parseInt(psql("SELECT count(*) FROM pg_policy WHERE polrelid = 'public.forum_upload_attempts'::regclass;").stdout, 10);
  assert.equal(baselinePolicies, 4, "R3 fixture must have four source-backed RLS policies");

  psql(proposal);
  assert.equal(psql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'consume_forum_rate_limit';").stdout, "1");

  resetAttempts();
  for (let attempt = 0; attempt < 10; attempt += 1) expectAllowed({ purpose: "post_create", bytes: 0 }, "post_create accepts the first ten");
  expectLimited({ purpose: "post_create", bytes: 0 }, "post_create denies the eleventh");
  assert.equal(countAttempts("purpose = 'post_create'"), 10);
  expectError({ purpose: "post_create", bytes: 1 }, /bytes must be zero/, "post_create rejects nonzero bytes");

  resetAttempts();
  for (let attempt = 0; attempt < 60; attempt += 1) expectAllowed({ purpose: "comment_create", bytes: 0 }, "comment_create accepts the first sixty");
  expectLimited({ purpose: "comment_create", bytes: 0 }, "comment_create denies the sixty-first");
  expectError({ purpose: "comment_create", bytes: 1 }, /bytes must be zero/, "comment_create rejects nonzero bytes");

  resetAttempts();
  for (let attempt = 0; attempt < 5; attempt += 1) expectAllowed({ purpose: "circle_create", bytes: 0 }, "circle_create accepts the first five");
  expectLimited({ purpose: "circle_create", bytes: 0 }, "circle_create denies the sixth");
  resetAttempts();
  psql(`INSERT INTO public.forum_upload_attempts (user_id, ip_hash, bytes, purpose, created_at) VALUES (${literal(users[0])}::uuid, ${literal(ip("b"))}, 0, 'circle_create', now() - INTERVAL '24 hours' - INTERVAL '1 second'), (${literal(users[0])}::uuid, ${literal(ip("b"))}, 0, 'circle_create', now() - INTERVAL '23 hours');`);
  for (let attempt = 0; attempt < 4; attempt += 1) expectAllowed({ user: users[0], hash: ip("b"), purpose: "circle_create", bytes: 0 }, "rolling 24-hour boundary excludes older rows");
  expectLimited({ user: users[0], hash: ip("b"), purpose: "circle_create", bytes: 0 }, "rolling 24-hour boundary retains active rows");

  resetAttempts();
  expectAllowed({ hash: ip("c"), purpose: "post_media_upload", bytes: 1 });
  expectAllowed({ hash: ip("c"), purpose: "post_media_upload", bytes: 157286400 });
  expectError({ hash: ip("c"), purpose: "post_media_upload", bytes: 157286401 }, /post media bytes are invalid/);
  expectError({ hash: ip("c"), purpose: "post_media_upload", bytes: 0 }, /post media bytes are invalid/);
  expectError({ hash: ip("c"), purpose: "post_media_upload", bytes: -1 }, /post media bytes are invalid/);
  resetAttempts();
  for (let attempt = 0; attempt < 10; attempt += 1) expectAllowed({ hash: ip("c"), purpose: "post_media_upload", bytes: 1 });
  expectLimited({ hash: ip("c"), purpose: "post_media_upload", bytes: 1 }, "post-media shared IP denies the eleventh");

  resetAttempts();
  expectAllowed({ hash: ip("d"), purpose: "external_video_upload", bytes: 1 });
  expectAllowed({ hash: ip("d"), purpose: "external_video_upload", bytes: 157286400 });
  expectError({ hash: ip("d"), purpose: "external_video_upload", bytes: 157286401 }, /external video bytes are invalid/);
  resetAttempts();
  expectAllowed({ hash: ip("d"), purpose: "external_video_upload", bytes: 157286400 });
  expectAllowed({ hash: ip("d"), purpose: "external_video_upload", bytes: 157286400 });
  assert.equal(byteSum("purpose = 'external_video_upload' AND ip_hash = '" + ip("d") + "'"), 314572800n);
  expectLimited({ hash: ip("d"), purpose: "external_video_upload", bytes: 157286400 }, "three maximum external-video attempts cannot oversubscribe the daily byte ledger");
  expectLimited({ hash: ip("d"), purpose: "external_video_upload", bytes: 1 }, "external-video daily quota denies one additional byte");
  assert.equal(countAttempts("purpose = 'external_video_upload' AND ip_hash = '" + ip("d") + "'"), 2, "denied external-video request inserts no row");
  psql("BEGIN; SELECT 1/0;", { allowFailure: true });
  assert.equal(countAttempts("purpose = 'external_video_upload' AND ip_hash = '" + ip("d") + "'"), 2, "accepted reservations remain charged after later-work failure");
  resetAttempts();
  for (let attempt = 0; attempt < 10; attempt += 1) expectAllowed({ hash: ip("d"), purpose: "external_video_upload", bytes: 1 });
  expectLimited({ hash: ip("d"), purpose: "external_video_upload", bytes: 1 }, "external-video hourly count denies the eleventh");

  resetAttempts();
  expectError({ purpose: "verification_email_resend", bytes: 0 }, /purpose is invalid/, "resend remains separate");
  expectError({ purpose: "unknown", bytes: 0 }, /purpose is invalid/, "invalid purpose rejects");
  expectError({ expressions: ["NULL::uuid", literal(ip("e")), literal("post_create"), "0::bigint"] }, /identity is required/, "null user rejects");
  expectError({ expressions: [`${literal(users[0])}::uuid`, "NULL::text", literal("post_create"), "0::bigint"] }, /IP hash is invalid/, "null IP rejects");
  expectError({ hash: "bad", purpose: "post_create", bytes: 0 }, /IP hash is invalid/, "malformed IP rejects");
  expectError({ expressions: [`${literal(users[0])}::uuid`, literal(ip("e")), "NULL::text", "0::bigint"] }, /purpose is invalid/, "null purpose rejects");
  expectError({ expressions: [`${literal(users[0])}::uuid`, literal(ip("e")), literal("post_create"), "NULL::bigint"] }, /bytes are required/, "null bytes rejects");
  expectError({ purpose: "external_video_upload", bytes: 9223372036854775807n }, /external video bytes are invalid/, "bigint maximum rejects before quota arithmetic");
  expectError({ expressions: [`${literal(users[0])}::uuid`, literal(ip("e")), literal("external_video_upload"), "9223372036854775808::bigint"] }, /bigint|out of range/i, "bigint overflow cannot wrap");
  assert.equal(countAttempts(), 0, "validation errors leave no attempt residue");

  resetAttempts();
  for (let attempt = 0; attempt < 9; attempt += 1) psql(`INSERT INTO public.forum_upload_attempts (user_id, ip_hash, bytes, purpose) VALUES (${literal(users[0])}::uuid, ${literal(ip("f"))}, 0, 'post_create');`);
  const oneSlot = await Promise.all(Array.from({ length: 6 }, () => psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[0])}::uuid, ${literal(ip("f"))}, 'post_create', 0::bigint);`, { role: "service_role" })));
  assert.equal(oneSlot.filter((result) => hasDecision(result, true, "ALLOWED")).length, 1, "one remaining user slot permits exactly one concurrent call");
  assert.equal(oneSlot.filter((result) => hasDecision(result, false, "RATE_LIMITED")).length, 5);
  assert.equal(countAttempts("purpose = 'post_create' AND user_id = '" + users[0] + "'"), 10);

  resetAttempts();
  const emptyUser = await Promise.all(Array.from({ length: 11 }, () => psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[1])}::uuid, ${literal(ip("g"))}, 'post_create', 0::bigint);`, { role: "service_role" })));
  assert.equal(emptyUser.filter((result) => hasDecision(result, true, "ALLOWED")).length, 10, "empty user scope permits exactly ten concurrent calls");
  assert.equal(emptyUser.filter((result) => hasDecision(result, false, "RATE_LIMITED")).length, 1);
  assert.equal(countAttempts("purpose = 'post_create' AND user_id = '" + users[1] + "'"), 10);

  resetAttempts();
  const sharedMedia = await Promise.all(Array.from({ length: 11 }, () => psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[2])}::uuid, ${literal(ip("h"))}, 'post_media_upload', 1::bigint);`, { role: "service_role" })));
  assert.equal(sharedMedia.filter((result) => hasDecision(result, true, "ALLOWED")).length, 10, "shared media IP permits exactly ten concurrent calls");
  assert.equal(sharedMedia.filter((result) => hasDecision(result, false, "RATE_LIMITED")).length, 1);
  assert.equal(countAttempts("purpose = 'post_media_upload' AND ip_hash = '" + ip("h") + "'"), 10);

  resetAttempts();
  expectAllowed({ user: users[2], hash: ip("i"), purpose: "external_video_upload", bytes: 157286400 });
  expectAllowed({ user: users[2], hash: ip("i"), purpose: "external_video_upload", bytes: 157286399 });
  const videoBoundary = await Promise.all(Array.from({ length: 5 }, () => psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[2])}::uuid, ${literal(ip("i"))}, 'external_video_upload', 1::bigint);`, { role: "service_role" })));
  assert.equal(videoBoundary.filter((result) => hasDecision(result, true, "ALLOWED")).length, 1, "one remaining daily byte permits exactly one concurrent call");
  assert.equal(byteSum("purpose = 'external_video_upload' AND ip_hash = '" + ip("i") + "'"), 314572800n, "concurrent external-video requests cannot oversubscribe bytes");
  assert.ok(countAttempts("purpose = 'external_video_upload' AND ip_hash = '" + ip("i") + "'") <= 10, "concurrent external-video requests cannot oversubscribe hourly count");

  resetAttempts();
  const independent = await Promise.all([
    psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[0])}::uuid, ${literal(ip("j"))}, 'post_create', 0::bigint);`, { role: "service_role" }),
    psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[1])}::uuid, ${literal(ip("j"))}, 'post_create', 0::bigint);`, { role: "service_role" }),
    psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[2])}::uuid, ${literal(ip("k"))}, 'post_media_upload', 1::bigint);`, { role: "service_role" }),
    psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[2])}::uuid, ${literal(ip("l"))}, 'post_media_upload', 1::bigint);`, { role: "service_role" }),
    psqlAsync(`SELECT allowed::text, decision FROM public.consume_forum_rate_limit(${literal(users[0])}::uuid, ${literal(ip("j"))}, 'comment_create', 0::bigint);`, { role: "service_role" }),
  ]);
  assert.ok(independent.every((result) => hasDecision(result, true, "ALLOWED")), "independent users, IPs, and purpose scopes do not block each other");

  resetAttempts();
  const lockHolder = await holderSession(`openglasshub:forum-rate-limit:v1:user:post_create:${users[0]}`);
  const lockStart = Date.now();
  const lockTimeout = call({ user: users[0], hash: ip("m"), purpose: "post_create", bytes: 0 });
  assert.ok(lockTimeout.error);
  assert.match(lockTimeout.error, /lock timeout/i);
  assert.ok(Date.now() - lockStart >= 750, "lock timeout must wait for the configured one-second boundary");
  lockHolder.release();
  await lockHolder.completed;
  assert.equal(countAttempts(), 0, "lock timeout rolls back without residue");

  psql(`
    CREATE FUNCTION public.r3_statement_timeout_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(4); RETURN NEW; END $$;
    CREATE TRIGGER r3_statement_timeout_before_insert BEFORE INSERT ON public.forum_upload_attempts FOR EACH ROW EXECUTE FUNCTION public.r3_statement_timeout_trigger();
  `);
  const statementTimeout = call({ user: users[0], hash: ip("n"), purpose: "post_create", bytes: 0, sessionStatements: ["SET statement_timeout = '3s';"] });
  assert.ok(statementTimeout.error);
  assert.match(statementTimeout.error, /statement timeout/i);
  psql("DROP TRIGGER r3_statement_timeout_before_insert ON public.forum_upload_attempts; DROP FUNCTION public.r3_statement_timeout_trigger();");
  assert.equal(countAttempts(), 0, "statement timeout rolls back without residue");

  psql(`
    CREATE FUNCTION public.r3_forced_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'R3 forced insert failure'; END $$;
    CREATE TRIGGER r3_forced_insert_failure_before_insert BEFORE INSERT ON public.forum_upload_attempts FOR EACH ROW EXECUTE FUNCTION public.r3_forced_insert_failure();
  `);
  const insertFailure = call({ user: users[0], hash: ip("o"), purpose: "post_create", bytes: 0 });
  assert.ok(insertFailure.error);
  assert.match(insertFailure.error, /R3 forced insert failure/);
  psql("DROP TRIGGER r3_forced_insert_failure_before_insert ON public.forum_upload_attempts; DROP FUNCTION public.r3_forced_insert_failure();");
  assert.equal(countAttempts(), 0, "forced insert failure rolls back without residue");

  for (const role of ["anon", "authenticated", "r3_public_probe"]) {
    const denied = call({ role });
    assert.ok(denied.error, `${role} must not execute the RPC`);
    assert.match(denied.error, /permission denied/i);
  }
  expectAllowed({ role: "service_role" }, "service_role executes without table grants");
  assert.equal(psql("SELECT has_table_privilege('service_role', 'public.forum_upload_attempts', 'SELECT')::text || ',' || has_table_privilege('service_role', 'public.forum_upload_attempts', 'INSERT')::text;").stdout, "false,false");

  const postflightResult = psql(postflight).stdout.split("\t");
  assert.equal(postflightResult[0], "public.consume_forum_rate_limit(uuid,text,text,bigint)");
  assert.equal(postflightResult[1], "1");
  const metadata = JSON.parse(postflightResult[2])[0];
  assert.equal(metadata.identity_arguments, "p_user_id uuid, p_ip_hash text, p_purpose text, p_bytes bigint");
  assert.equal(metadata.result_type, "TABLE(allowed boolean, decision text)");
  assert.equal(metadata.security_definer, true);
  assert.equal(metadata.volatility, "v");
  assert.equal(metadata.parallel, "u");
  assert.equal(metadata.leakproof, false);
  assert.equal(metadata.owner, "postgres");
  assert.deepEqual(metadata.search_path, ["search_path=pg_catalog, public, pg_temp", "lock_timeout=1s", "statement_timeout=3s"]);
  const grantees = new Map(metadata.acl.map((entry) => [entry.grantee, entry.privilege]));
  assert.equal(grantees.get("service_role"), "EXECUTE");
  assert.equal(grantees.has("PUBLIC"), false);
  assert.equal(grantees.has("anon"), false);
  assert.equal(grantees.has("authenticated"), false);
  assert.equal(psql("SELECT count(*) FROM pg_policy WHERE polrelid = 'public.forum_upload_attempts'::regclass;").stdout, "4", "R3 must not alter policies");
  assert.equal(psql("SELECT count(*) FROM pg_index WHERE indrelid = 'public.forum_upload_attempts'::regclass;").stdout, "6", "R3 must not alter indexes");
  assert.equal(psql("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'consume_verification_email_resend_limit';").stdout, "0", "minimal fixture intentionally omits the resend RPC");

  localRowCount = countAttempts();
} finally {
  if (containerStarted) {
    const dropDatabase = spawnSync("docker", ["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${database};`], { encoding: "utf8" });
    if (dropDatabase.status !== 0) throw new Error(dropDatabase.stderr || "R3 disposable database cleanup failed");
    const removal = spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
    if (removal.status !== 0 && !/No such container/i.test(removal.stderr)) throw new Error(removal.stderr || "R3 container removal failed");
  }
  const remainingContainers = docker(["ps", "-a", "--format", "{{.Names}}"]).split(/\r?\n/).filter(Boolean);
  const remainingVolumes = docker(["volume", "ls", "--format", "{{.Name}}"]).split(/\r?\n/).filter(Boolean);
  assert.equal(remainingContainers.includes(container), false, "R3 named container residue remains");
  assert.equal(remainingVolumes.includes(container), false, "R3 named volume residue remains");
  cleanupVerified = true;
}

console.log(JSON.stringify({
  localDockerOnly: true,
  schemaBaseline: "MINIMAL_SOURCE_BACKED_FIXTURE",
  proposalSha256: proposalHash,
  concurrency: { oneRemainingSlot: "1 allowed / 5 rate-limited", emptyUserScope: "10 allowed / 1 rate-limited", sharedMediaScope: "10 allowed / 1 rate-limited", externalVideoBoundary: "1 allowed / 4 rate-limited" },
  externalVideoAcceptedByteMaximum: 314572800,
  localRowCountBeforeTeardown: localRowCount,
  cleanupVerified,
  externalOperations: 0,
  productionOperations: 0,
}));
