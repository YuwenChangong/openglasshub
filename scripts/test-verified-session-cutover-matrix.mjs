import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import pg from "pg";
import { buildLocalSupabaseReplayMirror, ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";
import { createTaskOwnedSupabaseOutbound } from "./lib/verified-session-local-outbound.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD_COMMIT = "e6c2141be8827d961fc49462d66be8da9b4993eb";
const OWNED_PREFIX = "ogh-cutover-a-";
const LOCAL_KV_NAMESPACES = ["SESSION"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_ENV_NAMES = /^(path|systemroot|windir|temp|tmp|comspec|pathext|appdata|localappdata|userprofile)$/i;
const CACHED_LOCAL_IMAGES = [
  "gotrue:v2.195.0", "kong:2.8.1", "logflare:1.50.2", "mailpit:v1.30.2",
  "postgres-meta:v0.98.0", "postgres:17.6.1.159", "postgrest:v16.1",
  "realtime:v2.129.0", "storage-api:v1.69.11", "studio:2026.08.17-sha-0c1da8f",
  "vector:0.53.0-alpine", "edge-runtime:v1.74.3", "imgproxy:v3.8.0",
].map((image) => `public.ecr.aws/supabase/${image}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isRuntimeEnvFile = (name) => /^(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?)$/.test(name) && !name.endsWith(".example");
const BINDING_MANIFEST = path.join(ROOT, ".superpowers/sdd/2026-09-25-verified-session-v1-cutover-bridge/task6-binding-manifest.json");

function bindingClass(value) {
  if (value === "" || value == null) return { TARGET_CLASS: "EMPTY", SCHEME_CLASS: "other", HOST_CLASS: "empty" };
  try {
    const url = new URL(value);
    const loopback = LOOPBACK.has(url.hostname);
    return { TARGET_CLASS: loopback ? "LOOPBACK" : "NON_LOOPBACK",
      SCHEME_CLASS: ["http:", "https:"].includes(url.protocol) ? url.protocol.slice(0, -1) : "other",
      HOST_CLASS: loopback ? "loopback" : "non-loopback" };
  } catch { return { TARGET_CLASS: "UNKNOWN", SCHEME_CLASS: "other", HOST_CLASS: "unknown" }; }
}

function assertLocalGeneratedBindings(generated) {
  const namespaces = generated.kv_namespaces ?? [];
  const localSessionOnly = namespaces.length === 1 && namespaces[0]?.binding === "SESSION" &&
    Object.keys(namespaces[0]).sort().join(",") === "binding";
  assert.ok(!generated.env && !generated.r2_buckets?.length && localSessionOnly,
    `OLD_WORKER_REMOTE_BINDING_PRESENT:env=${Boolean(generated.env)}:r2=${generated.r2_buckets?.length ?? 0}:kv=${generated.kv_namespaces?.length ?? 0}`);
}

async function preserveBindingManifest(generated) {
  const bindings = [
    ...Object.entries(generated.vars ?? {}).map(([name, value]) => ({ BINDING_NAME: name, BINDING_TYPE: "var", ...bindingClass(value) })),
    ...(generated.r2_buckets ?? []).map((entry) => ({ BINDING_NAME: entry.binding ?? "UNKNOWN", BINDING_TYPE: "r2_bucket", TARGET_CLASS: "NON_LOOPBACK" })),
    ...(generated.kv_namespaces ?? []).map((entry) => ({ BINDING_NAME: entry.binding ?? "UNKNOWN", BINDING_TYPE: "kv_namespace",
      TARGET_CLASS: entry.binding === "SESSION" && Object.keys(entry).sort().join(",") === "binding" ? "TASK_OWNED_LOCAL" : "NON_LOOPBACK" })),
  ];
  if (generated.env) bindings.push({ BINDING_NAME: "env", BINDING_TYPE: "environment_section", TARGET_CLASS: "UNKNOWN" });
  await writeFile(BINDING_MANIFEST, JSON.stringify(bindings, null, 2) + "\n");
}

function checkLoopback(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}_NOT_URL`); }
  assert.ok(LOOPBACK.has(url.hostname) && ["http:", "https:", "postgresql:", "postgres:"].includes(url.protocol), `${label}_NOT_LOOPBACK`);
  assert.equal(url.username === "" || label === "DB_URL", true, `${label}_CREDENTIALS_UNEXPECTED`);
  return url;
}

function childEnv(extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => SAFE_ENV_NAMES.test(key))),
    CI: "1", NO_UPDATE_NOTIFIER: "1", WRANGLER_SEND_METRICS: "false",
    SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "", SUPABASE_DB_URL: "",
    ...extra,
  };
}

async function command(exe, args, cwd, env = childEnv(), timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else child.kill("SIGKILL");
      } catch { child.kill(); }
    }, timeoutMs) : null;
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return reject(new Error(`${path.basename(exe)}:${args[0]}:OWNED_CLI_TIMEOUT`));
      if (code === 0) return resolve(output);
      const diagnostic = output.split(/\r?\n/)
        .filter(Boolean).slice(-12).join(" | ")
        .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[URL]")
        .replace(/[A-Za-z0-9_+/=-]{48,}/g, "[REDACTED]")
        .slice(0, 800);
      const error = new Error(`${path.basename(exe)}:${args[0]}:EXIT_${code}:${diagnostic}`);
      error.output = output;
      reject(error);
    });
  });
}

async function git(args, cwd = ROOT) { return (await command("git", args, cwd)).trim(); }

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function ownedPath(candidate, ownedRoot) {
  const parent = await realpath(ownedRoot);
  const target = await realpath(candidate);
  assert.equal(path.dirname(target).toLowerCase(), parent.toLowerCase(), "UNOWNED_TEMP_PATH");
  assert.ok(path.basename(target).startsWith(OWNED_PREFIX), "UNOWNED_TEMP_PATH");
  return target;
}

async function oldWorkerModules(entry) {
  const root = path.dirname(entry);
  const files = [];
  async function visit(directory) {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, child.name);
      if (child.isDirectory()) await visit(candidate);
      else if ([".js", ".mjs"].includes(path.extname(child.name))) files.push(candidate);
    }
  }
  await visit(root);
  files.sort((left, right) => left === entry ? -1 : right === entry ? 1 : left.localeCompare(right));
  return files.map((file) => ({ type: "ESModule", path: file }));
}

function createLocalWorker(options) {
  return new Miniflare(convertV4MiniflareOptions(options));
}

function assertAllowedRootStatus(status) {
  const allowed = new Set([
    "?? scripts/test-verified-session-cutover-matrix.mjs",
    "?? scripts/test-verified-session-local-outbound.mjs",
    "?? scripts/lib/verified-session-local-outbound.mjs",
  ]);
  for (const line of status.split("\n").filter(Boolean)) assert.ok(allowed.has(line), "DIRTY_ROOT_CHECKOUT");
}

async function assertRoot() {
  assert.equal(path.resolve(await git(["rev-parse", "--show-toplevel"])).toLowerCase(), ROOT.toLowerCase(), "ROOT_IDENTITY_MISMATCH");
  const status = await git(["status", "--porcelain", "--untracked-files=all"]);
  assertAllowedRootStatus(status);
  assert.equal(await git(["cat-file", "-t", OLD_COMMIT]), "commit", "PINNED_OLD_SOURCE_MISSING");
}

async function configureSupabase(ownedRoot, projectId) {
  const cli = path.join(ROOT, "node_modules/supabase/dist/supabase.js");
  await command(process.execPath, [cli, "init", "--yes", "--workdir", ownedRoot], ownedRoot);
  const configPath = path.join(ownedRoot, "supabase/config.toml");
  let config = await readFile(configPath, "utf8");
  config = config.replace(/^project_id = "[^"]+"/m, `project_id = "${projectId}"`);
  for (const section of ["api", "db", "studio", "local_smtp", "analytics", "db.pooler", "edge_runtime"]) {
    const match = config.match(new RegExp(`\\[${section.replaceAll(".", "\\.")}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    assert.ok(match, `LOCAL_CONFIG_SECTION_MISSING:${section}`);
    const key = section === "edge_runtime" ? "inspector_port" : "port";
    const next = match[0].replace(new RegExp(`(^${key}\\s*=\\s*)\\d+`, "m"), `$1${await freePort()}`);
    assert.notEqual(next, match[0], `LOCAL_CONFIG_PORT_MISSING:${section}`);
    config = config.replace(match[0], next);
  }
  config = config.replace(/(\[db\][\s\S]*?\nshadow_port\s*=\s*)\d+/, `$1${await freePort()}`);
  config = config.replace(/(\[auth\.email\]\s*[\s\S]*?enable_confirmations\s*=\s*)false/, "$1true");
  await writeFile(configPath, config);

  const historical = path.join(ownedRoot, "historical-migrations");
  await mkdir(historical);
  for (const filename of ORDERED_MIGRATION_FILENAMES) {
    const bytes = execFileSync("git", ["-C", ROOT, "cat-file", "blob", `HEAD:supabase/migrations/${filename}`],
      { env: childEnv(), windowsHide: true });
    await writeFile(path.join(historical, filename), bytes, { flag: "wx" });
  }
  await buildLocalSupabaseReplayMirror({ canonicalDirectory: historical,
    outputDirectory: path.join(ownedRoot, "supabase/migrations"),
    mappingPath: path.join(ownedRoot, "mapping.json"), repositoryRoot: ROOT });
  return cli;
}

async function startSupabase(cli, ownedRoot) {
  const cliPackage = JSON.parse(await readFile(path.join(ROOT, "node_modules/supabase/package.json"), "utf8"));
  assert.equal(cliPackage.version, "2.115.0", "LOCAL_SUPABASE_CLI_VERSION_DRIFT");
  try { await command("docker", ["image", "inspect", ...CACHED_LOCAL_IMAGES], ownedRoot); }
  catch { throw new Error("LOCAL_SUPABASE_IMAGE_CACHE_INCOMPLETE"); }
  await command(process.execPath, [cli, "start", "--workdir", ownedRoot], ownedRoot);
  const raw = await command(process.execPath, [cli, "status", "--output", "json", "--workdir", ownedRoot], ownedRoot);
  const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  for (const field of ["API_URL", "DB_URL", "INBUCKET_URL"]) checkLoopback(status[field], field);
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, "LOCAL_KEYS_MISSING");
  return status;
}

async function localOldBuild(oldRoot, status) {
  const envFiles = (await readdir(oldRoot)).filter(isRuntimeEnvFile);
  assert.equal(envFiles.length, 0, "OLD_ENV_FILE_PRESENT");
  const localVars = {
    SUPABASE_URL: status.API_URL, PUBLIC_SUPABASE_URL: status.API_URL,
    PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SITE_ORIGIN: "https://127.0.0.1",
    MODERATION_PROVIDER: "local", OPENAI_MODERATION_ENABLED: "false",
    OPENAI_POST_IMAGE_MODERATION_ENABLED: "false", OPENAI_PROFILE_IMAGE_MODERATION_ENABLED: "false",
    OPENAI_CIRCLE_COVER_MODERATION_ENABLED: "false", OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED: "false",
    OPENAI_FORUM_POLICY_ENABLED: "false", UPLOAD_TURNSTILE_MODE: "off", DEV_TURNSTILE_BYPASS: "false",
  };
  checkLoopback(localVars.SUPABASE_URL, "SUPABASE_URL");
  // Astro's platform proxy reads the root config. The detached worktree is disposable and owned.
  const tomlVars = Object.entries(localVars).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n");
  await writeFile(path.join(oldRoot, "wrangler.toml"),
    `name = "ogh-cutover-old-local"\ncompatibility_date = "2026-05-17"\ncompatibility_flags = ["nodejs_compat"]\n[vars]\n${tomlVars}\n`);
  const buildEnv = childEnv({ ...localVars, SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, RATE_LIMIT_SALT: `local-${randomUUID()}` });
  const astro = path.join(oldRoot, "node_modules/astro/bin/astro.mjs");
  await command(process.execPath, [astro, "build"], oldRoot, buildEnv);
  const generatedPath = path.join(oldRoot, "dist/server/wrangler.json");
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  await preserveBindingManifest(generated);
  assert.ok(generated.main && generated.assets?.directory, "OLD_WORKER_BUILD_LAYOUT_UNEXPECTED");
  for (const [name, value] of Object.entries(generated.vars ?? {})) {
    if (/(?:^|_)URL$|ORIGIN$|BASE_URL$/.test(name) && value) checkLoopback(value, `GENERATED_${name}`);
  }
  const configVars = { ...(generated.vars ?? {}), ...localVars,
    SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    RATE_LIMIT_SALT: buildEnv.RATE_LIMIT_SALT };
  for (const [name, value] of Object.entries(configVars)) {
    if (/(?:^|_)URL$|ORIGIN$|BASE_URL$/.test(name) && value) checkLoopback(value, name);
  }
  assert.equal(configVars.SUPABASE_URL, status.API_URL, "OLD_WORKER_DB_BINDING_MISMATCH");
  assert.equal(configVars.PUBLIC_SUPABASE_URL, status.API_URL, "OLD_WORKER_PUBLIC_BINDING_MISMATCH");
  assert.equal(configVars.SUPABASE_ANON_KEY, status.ANON_KEY, "OLD_WORKER_ANON_BINDING_MISMATCH");
  assert.equal(generated.name, "ogh-cutover-old-local", "OLD_WORKER_GENERATED_CONFIG_IDENTITY_MISMATCH");
  assertLocalGeneratedBindings(generated);
  const entry = path.resolve(path.dirname(generatedPath), generated.main);
  const assets = path.resolve(path.dirname(generatedPath), generated.assets.directory);
  const digest = sha256(await readFile(entry));
  return { entry, assets, configVars, generated, digest };
}

async function proveBaseline(worker, status, dbUrl) {
  const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `matrix-${randomUUID()}@example.test`;
  const password = `LocalOnly-${randomUUID()}!`;
  const created = await anon.auth.signUp({ email, password });
  assert.equal(created.error, null, "BASELINE_SIGNUP_FAILED");
  const db = new pg.Pool({ connectionString: dbUrl });
  try {
    await db.query("UPDATE auth.users SET email_confirmed_at = now() WHERE email = $1", [email]);
    const login = await anon.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null, "BASELINE_LOGIN_FAILED");
    const token = login.data.session?.access_token;
    assert.ok(token, "BASELINE_SESSION_MISSING");
    const profile = await anon.from("profiles").select("id").eq("id", login.data.user.id).maybeSingle();
    assert.equal(profile.error, null, "BASELINE_AUTHENTICATED_READ_FAILED");
    const write = await anon.from("profiles").update({ display_name: "Matrix A" }).eq("id", login.data.user.id).select("display_name").single();
    assert.equal(write.error, null, "BASELINE_AUTHENTICATED_WRITE_FAILED");
    assert.equal(write.data.display_name, "Matrix A", "BASELINE_AUTHENTICATED_WRITE_NOT_PERSISTED");
    const get = async (pathname, headers = {}) => worker.dispatchFetch(`http://127.0.0.1${pathname}`, { headers });
    for (const pathname of ["/products/", "/feed/", "/news/", "/api/news"]) {
      const response = await get(pathname);
      const body = await response.text();
      assert.equal(response.status, 200, `BASELINE_PUBLIC_READ_FAILED:${pathname}`);
      assert.ok(body.length > 0, `BASELINE_PUBLIC_READ_EMPTY:${pathname}`);
    }
    const bearer = { authorization: `Bearer ${token}` };
    const consentBefore = await get("/api/legal/consent", bearer);
    assert.equal(consentBefore.status, 200, "BASELINE_LEGAL_CONSENT_READ_FAILED");
    const consent = await worker.dispatchFetch("http://127.0.0.1/api/legal/consent", {
      method: "POST", headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ accepted: true, source: "login" }),
    });
    assert.equal(consent.status, 200, "BASELINE_LEGAL_CONSENT_WRITE_FAILED");
    assert.equal((await consent.json()).current, true, "BASELINE_LEGAL_CONSENT_NOT_CURRENT");
    const resend = await worker.dispatchFetch("http://127.0.0.1/api/auth/resend-confirmation", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({ email }),
    });
    assert.equal(resend.status, 200, "BASELINE_OLD_ANON_RESEND_FAILED");
    assert.equal((await resend.json()).ok, true, "BASELINE_OLD_ANON_RESEND_NOT_OK");
    const quota = await db.query("SELECT count(*)::int AS n FROM public.forum_upload_attempts WHERE purpose='verification_email_resend'");
    assert.equal(quota.rows[0].n, 1, "BASELINE_OLD_ANON_RESEND_RPC_NOT_USED");
  } finally { await db.end(); }
}

async function portOpen(urlText) {
  const url = new URL(urlText);
  return new Promise((resolve) => {
    const socket = net.connect(Number(url.port), url.hostname);
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

async function teardownDiagnostic(kind) {
  await assertRoot();
  const id = randomUUID().slice(0, 8);
  const ownedRoot = await mkdtemp(path.join(os.tmpdir(), `${OWNED_PREFIX}${id}-`));
  const oldRoot = path.join(ownedRoot, `${OWNED_PREFIX}worktree`);
  let cli, status, worker, worktreeAdded = false, started = false;
  let stopResult = "NOT_RUN", stopDurationMs = 0, workerStarted = false;
  try {
    await ownedPath(ownedRoot, os.tmpdir());
    cli = await configureSupabase(ownedRoot, `${OWNED_PREFIX}${id}`);
    started = true;
    status = await startSupabase(cli, ownedRoot);
    if (kind === "T2") {
      await git(["worktree", "add", "--detach", oldRoot, OLD_COMMIT]);
      worktreeAdded = true;
      assert.equal(await git(["rev-parse", "HEAD"], oldRoot), OLD_COMMIT);
      if (process.platform === "win32") await command(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", "npm.cmd ci --offline --ignore-scripts --no-audit --no-fund"], oldRoot);
      else await command("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], oldRoot);
      const built = await localOldBuild(oldRoot, status);
      worker = createLocalWorker({
        modules: await oldWorkerModules(built.entry), modulesRoot: path.dirname(built.entry),
        compatibilityDate: built.generated.compatibility_date ?? "2026-05-17",
        compatibilityFlags: built.generated.compatibility_flags ?? ["nodejs_compat"],
        kvNamespaces: LOCAL_KV_NAMESPACES, bindings: built.configVars,
        assets: { directory: built.assets, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
        outboundService: createTaskOwnedSupabaseOutbound(status.API_URL),
      });
      await worker.getBindings();
      workerStarted = true;
    } else if (kind === "T3") {
      assert.throws(() => assertLocalGeneratedBindings({ r2_buckets: [{ binding: "UNSAFE" }] }),
        /OLD_WORKER_REMOTE_BINDING_PRESENT/);
    }
  } finally {
    if (worker) await worker.dispose();
    if (started && cli) {
      const began = Date.now();
      try {
        await command(process.execPath, [cli, "stop", "--no-backup", "--workdir", ownedRoot], ownedRoot, childEnv(), 45_000);
        stopResult = "ZERO_EXIT";
      } catch (error) { stopResult = error.message.includes("OWNED_CLI_TIMEOUT") ? "TIMEOUT" : "NONZERO_EXIT"; }
      stopDurationMs = Date.now() - began;
    }
    const containers = (await command("docker", ["ps", "--format", "{{.Names}}"], ownedRoot))
      .split(/\r?\n/).filter((name) => name.includes(`${OWNED_PREFIX}${id}`));
    const ports = status ? await Promise.all([status.API_URL, status.DB_URL, status.INBUCKET_URL].map(portOpen)) : [];
    console.log(`TEARDOWN_${kind}=START_RESULT=${status ? "PASS" : "FAIL"} WORKER_STARTED=${workerStarted} STOP_DURATION_MS=${stopDurationMs} STOP_EXIT_CODE=${stopResult} OWNED_CONTAINER_REMAINS=${containers.length} OWNED_PORT_REMAINS=${ports.filter(Boolean).length}`);
    if (worktreeAdded) await git(["worktree", "remove", "--force", oldRoot]);
    if (stopResult === "ZERO_EXIT" && containers.length === 0 && ports.every((open) => !open)) {
      await ownedPath(ownedRoot, os.tmpdir());
      await rm(ownedRoot, { recursive: true });
    }
  }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2].startsWith("--teardown-diagnostic=")) {
    const kind = process.argv[2].split("=")[1];
    assert.ok(["T1", "T2", "T3"].includes(kind), "TASK6_DIAGNOSTIC_KIND_INVALID");
    await teardownDiagnostic(kind);
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--self-test") {
    assert.doesNotThrow(() => assertLocalGeneratedBindings({ kv_namespaces: [{ binding: "SESSION" }] }));
    for (const generated of [
      { kv_namespaces: [{ binding: "SESSION", id: "remote" }] },
      { kv_namespaces: [{ binding: "OTHER" }] },
      { kv_namespaces: [{ binding: "SESSION" }, { binding: "OTHER" }] },
      { r2_buckets: [{ binding: "MEDIA" }] },
      { env: { production: {} } },
    ]) assert.throws(() => assertLocalGeneratedBindings(generated), /OLD_WORKER_REMOTE_BINDING_PRESENT/);
    assert.equal(isRuntimeEnvFile(".env.example"), false);
    for (const name of [".env", ".env.local", ".dev.vars", ".dev.vars.production"])
      assert.equal(isRuntimeEnvFile(name), true, `${name} must be rejected`);
    assertAllowedRootStatus("");
    assertAllowedRootStatus("?? scripts/test-verified-session-cutover-matrix.mjs\n?? scripts/test-verified-session-local-outbound.mjs\n?? scripts/lib/verified-session-local-outbound.mjs");
    for (const dirty of [" M src/pages/index.astro", "?? other.txt",
      "?? scripts/test-verified-session-cutover-matrix.mjs\n?? other.txt"]) {
      assert.throws(() => assertAllowedRootStatus(dirty), /DIRTY_ROOT_CHECKOUT/);
    }
    for (const unsafe of ["https://example.invalid", "postgresql://example.invalid/db", "http://localhost.example.invalid"])
      assert.throws(() => checkLoopback(unsafe, "SELF_TEST"), /SELF_TEST_NOT_LOOPBACK/);
    checkLoopback("http://127.0.0.1:54321", "SELF_TEST");
    await assertRoot();
    console.log("MATRIX_A_GUARDS=PASS");
    return;
  }
  assert.deepEqual(process.argv.slice(2), ["--state", "A"], "TASK6_STATE_A_ONLY");
  await assertRoot();
  const id = randomUUID().slice(0, 8);
  const ownedRoot = await mkdtemp(path.join(os.tmpdir(), `${OWNED_PREFIX}${id}-`));
  const oldRoot = path.join(ownedRoot, `${OWNED_PREFIX}worktree`);
  let worktreeAdded = false, supabaseStarted = false, cli, worker, status, digest;
  try {
    await ownedPath(ownedRoot, os.tmpdir());
    assert.equal(await git(["cat-file", "-t", OLD_COMMIT]), "commit", "PINNED_OLD_SOURCE_MISSING");
    await git(["worktree", "add", "--detach", oldRoot, OLD_COMMIT]);
    worktreeAdded = true;
    await ownedPath(oldRoot, ownedRoot);
    assert.equal(await git(["rev-parse", "HEAD"], oldRoot), OLD_COMMIT, "OLD_SOURCE_IDENTITY_MISMATCH");
    assert.equal(await git(["status", "--porcelain"], oldRoot), "", "OLD_SOURCE_DIRTY");
    cli = await configureSupabase(ownedRoot, `${OWNED_PREFIX}${id}`);
    supabaseStarted = true;
    status = await startSupabase(cli, ownedRoot);
    try {
      if (process.platform === "win32") {
        await command(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", "npm.cmd ci --offline --ignore-scripts --no-audit --no-fund"], oldRoot);
      } else {
        await command("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], oldRoot);
      }
    } catch (error) {
      throw new Error(/ENOTCACHED|cache mode is 'only-if-cached'/i.test(error.output ?? "")
        ? "OFFLINE_DEPENDENCY_CACHE_MISSING" : "OFFLINE_NPM_CI_FAILED");
    }
    const built = await localOldBuild(oldRoot, status);
    worker = createLocalWorker({
      modules: await oldWorkerModules(built.entry), modulesRoot: path.dirname(built.entry),
      compatibilityDate: built.generated.compatibility_date ?? "2026-05-17",
      compatibilityFlags: built.generated.compatibility_flags ?? ["nodejs_compat"],
      kvNamespaces: LOCAL_KV_NAMESPACES,
      bindings: built.configVars, assets: { directory: built.assets, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
      outboundService: createTaskOwnedSupabaseOutbound(status.API_URL),
    });
    const runtimeBindings = await worker.getBindings();
    assert.ok(runtimeBindings.SUPABASE_SERVICE_ROLE_KEY, "LOCAL_SERVICE_BINDING_MISSING");
    await proveBaseline(worker, status, status.DB_URL);
    digest = built.digest;
  } finally {
    const cleanupErrors = [];
    if (worker) try { await worker.dispose(); } catch { cleanupErrors.push("WORKER_STOP_FAILED"); }
    if (supabaseStarted && cli) {
      try { await command(process.execPath, [cli, "stop", "--no-backup", "--workdir", ownedRoot], ownedRoot, childEnv(), 45_000); }
      catch { cleanupErrors.push("LOCAL_SUPABASE_STOP_FAILED"); }
    }
    if (status) {
      const containers = (await command("docker", ["ps", "--format", "{{.Names}}"], ownedRoot))
        .split(/\r?\n/).filter((name) => name.includes(`${OWNED_PREFIX}${id}`));
      const ports = await Promise.all([status.API_URL, status.DB_URL, status.INBUCKET_URL].map(portOpen));
      if (containers.length || ports.some(Boolean)) cleanupErrors.push("OWNED_RUNTIME_RESOURCES_REMAIN");
    }
    if (worktreeAdded) {
      try {
        await ownedPath(oldRoot, ownedRoot);
        assert.equal(await git(["rev-parse", "HEAD"], oldRoot), OLD_COMMIT, "CLEANUP_OLD_SOURCE_IDENTITY_MISMATCH");
        assert.equal(path.resolve(await git(["rev-parse", "--show-toplevel"], oldRoot)).toLowerCase(),
          oldRoot.toLowerCase(), "CLEANUP_WORKTREE_PATH_MISMATCH");
        await git(["worktree", "remove", "--force", oldRoot]);
      } catch { cleanupErrors.push("OWNED_WORKTREE_CLEANUP_FAILED"); }
    }
    if (!cleanupErrors.includes("OWNED_WORKTREE_CLEANUP_FAILED") && !cleanupErrors.includes("LOCAL_SUPABASE_STOP_FAILED")
      && !cleanupErrors.includes("OWNED_RUNTIME_RESOURCES_REMAIN")) {
      await ownedPath(ownedRoot, os.tmpdir());
      await rm(ownedRoot, { recursive: true });
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join(","));
  }
  console.log(`MATRIX_A=PASS OLD_WORKER_SOURCE=${OLD_COMMIT} OLD_ARTIFACT_SHA256=${digest} DB_STAGE=PRE_V1 OLD_PREV1_PAIRING=ALLOW BINDINGS_LOCAL_ONLY=true HOSTED_BINDINGS_PRESENT=false PRODUCTION_BINDINGS_PRESENT=false PUBLIC_READS=PASS AUTH_BASELINE_LOGIN=PASS AUTHENTICATED_WRITE=PASS OLD_RESEND=PASS LEGAL_CONSENT_BASELINE=PASS TEARDOWN_BOUNDED=PASS OWNED_PROCESSES_REMAINING=0 OWNED_RUNTIME_RESOURCES_REMAINING=0`);
}

main().catch((error) => {
  console.error(`MATRIX_A=BLOCKED ${error.message}`);
  process.exitCode = 1;
});
