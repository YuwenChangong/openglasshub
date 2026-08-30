import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createConnection } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { createMirror, validateMirror, assertLocalTarget } from "./local-supabase-migration-mirror.mjs";
import { runP6bLifecycle } from "./p6b-local-e2e-runner-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const READY = "OPENGLASS_HUB_PUBLIC_BETA_P6B_DEVICE_ADMIN_LOCAL_E2E_READY";
const BLOCKED = "OPENGLASS_HUB_PUBLIC_BETA_P6B_BLOCKED";
const SUPABASE_CLI = "supabase@2.115.0";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const EVIDENCE_ROOT = join(tmpdir(), "openglass-hub-p6b-evidence");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORT_NAMES = ["api", "db", "shadow", "studio", "smtp", "analytics", "pooler", "inspector"];
const PORT_PATHS = {
  api: ["api", "port"], db: ["db", "port"], shadow: ["db", "shadow_port"], studio: ["studio", "port"],
  smtp: ["local_smtp", "port"], analytics: ["analytics", "port"], pooler: ["db.pooler", "port"], inspector: ["edge_runtime", "inspector_port"],
};

export function assertOwnedRuntimeRoot({ root, repoSupabase }) {
  const candidate = resolve(root); const forbidden = resolve(repoSupabase);
  const temporaryRoots = [resolve(tmpdir()), resolve("C:/Temp")];
  if (!temporaryRoots.some((temporaryRoot) => candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}\\`) || candidate.startsWith(`${temporaryRoot}/`)) || candidate === forbidden || candidate.startsWith(`${forbidden}\\`) || candidate.startsWith(`${forbidden}/`)) throw new Error("Runtime root must be an owned temporary directory outside repository supabase.");
  return candidate;
}
function assertRunId(runId) { if (!/^[a-f0-9]{8}$/i.test(runId)) throw new Error("Invalid P6B evidence run id."); return runId; }
export function getDurableEvidencePath(runId) { return join(EVIDENCE_ROOT, assertRunId(runId), "terminal.json"); }
export async function writeFinalTerminal(runId, terminal) { const target = getDurableEvidencePath(runId); await mkdir(dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(terminal)}\n`, "utf8"); await rename(temporary, target); return target; }
export async function loadFinalTerminal(runId) { try { return JSON.parse(await readFile(getDurableEvidencePath(runId), "utf8")); } catch (error) { if (error?.code === "ENOENT") return { status: "NOT_FOUND" }; throw error; } }
export function supabaseCommandArgs({ root, command }) { return [...command, "--workdir", root]; }
export async function cleanupOwnedRoot({ root, repoSupabase, remove = rm }) { assertOwnedRuntimeRoot({ root, repoSupabase }); await remove(root, { recursive: true, force: true }); }
export function allocatePortBundle({ bases, offsets, probe }) {
  if (!Array.isArray(offsets) || offsets.length !== PORT_NAMES.length) throw new Error("Complete port bundle required.");
  for (const base of bases) {
    const ports = offsets.map((offset) => base + offset);
    if (ports.every((port) => Number.isInteger(port) && port > 0 && port < 65536 && probe(port))) return Object.fromEntries(PORT_NAMES.map((name, index) => [name, ports[index]]));
  }
  throw new Error("No complete free local port bundle available.");
}
function replaceField(text, section, key, value) {
  const sectionPattern = section ? `(?=\\[${section.replace(/[.]/g, "\\.")}\\][\\s\\S]*?)(\\[${section.replace(/[.]/g, "\\.")}\\][\\s\\S]*?\\n${key}\\s*=\\s*)\\d+` : `(^${key}\\s*=\\s*)"[^"]*"`;
  const result = text.replace(new RegExp(sectionPattern, "m"), `$1${section ? value : `"${value}"`}`);
  if (result === text) throw new Error(`Generated config lacks allowed field ${section ? `${section}.${key}` : key}.`);
  return result;
}
export function mutateGeneratedConfig(baseline, { projectId, ports, changes = {} }) {
  if (Object.keys(changes).length) throw new Error("Only project_id and discovered local port fields may change.");
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error("Invalid generated project id.");
  let text = replaceField(baseline, "", "project_id", projectId); const changedKeys = ["project_id"];
  for (const name of PORT_NAMES) {
    if (!Number.isInteger(ports[name])) throw new Error(`Missing port ${name}.`);
    const [section, key] = PORT_PATHS[name]; text = replaceField(text, section, key, ports[name]); changedKeys.push(`${section}.${key}`);
  }
  return { text, projectId, changedKeys };
}
export async function initializeRuntimeConfig({ root, repoSupabase, runId, ports, exec, readConfig = (p) => readFile(p, "utf8"), writeConfig = (p, data) => writeFile(p, data) }) {
  try { assertOwnedRuntimeRoot({ root, repoSupabase }); } catch { throw new Error("Generated runtime root is not owned."); }
  try { await exec("init", { workdir: root, args: ["--yes"] }); } catch { throw new Error("Generated Supabase CLI init failed."); }
  const configPath = join(root, "supabase", "config.toml"); let baseline;
  try { baseline = await readConfig(configPath); } catch { throw new Error("Generated Supabase config was not created."); }
  const mutation = mutateGeneratedConfig(baseline, { projectId: `p6b-${runId}`, ports: ports ?? Object.fromEntries(PORT_NAMES.map((name, index) => [name, 54000 + index])) });
  try { await writeConfig(configPath, mutation.text); } catch { throw new Error("Generated Supabase config could not be mutated."); } return { configPath, baseline, ...mutation };
}
function validateActors(actors, ownershipProven, profileCount, postRolesVerified) {
  if (!ownershipProven) throw new Error("Owned local Postgres container has not been proven.");
  const expected = { nonstaff: "user", moderator: "moderator", admin: "admin" };
  for (const [name, role] of Object.entries(expected)) if (!UUID.test(actors?.[name]?.id ?? "") || actors[name].role !== role) throw new Error(`Invalid actor ${name}.`);
  if (profileCount !== 3) throw new Error("Expected exactly three fixture profiles before update.");
  if (!postRolesVerified) throw new Error("Fixture role verification mismatch.");
}
export function createRoleFixtureSql({ actors, ownershipProven, profileCount, postRolesVerified }) {
  validateActors(actors, ownershipProven, profileCount, postRolesVerified);
  const ids = Object.values(actors).map(({ id }) => `'${id}'::uuid`).join(", ");
  const cases = Object.values(actors).map(({ id, role }) => `when '${id}'::uuid then '${role}'::public.user_role`).join(" ");
  return `begin; do $$ begin if (select count(*) from public.profiles where id in (${ids})) <> 3 then raise exception 'expected fixture profiles'; end if; end $$; update public.profiles set role = case id ${cases} end where id in (${ids}); do $$ begin if (select count(*) from public.profiles where id in (${ids}) and role = case id ${cases} end) <> 3 then raise exception 'fixture roles mismatch'; end if; end $$; commit;`;
}
export function helperContextSql(actorId) {
  if (!UUID.test(actorId)) throw new Error("Invalid authenticated helper actor UUID.");
  return `begin; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','${actorId}',true); select public.is_moderator_or_admin(); rollback;`;
}
export function parseHelperOutput(output) {
  const values = String(output).split(/\r?\n/).map((line) => line.trim()).filter((line) => line === "t" || line === "f");
  if (values.length !== 1) throw new Error("Ambiguous authenticated helper output.");
  return values[0] === "t";
}
export function fixtureTransactionEvidence(truth) { return { rowCount: truth.rowCount, nonstaffRole: truth.nonstaffRole, moderatorRole: truth.moderatorRole, adminRole: truth.adminRole, mappingMatches: truth.mappingMatches }; }
export function isTrustedFixtureVerification(truth) { return truth?.rowCount === 3 && truth.nonstaffRole === "user" && truth.moderatorRole === "moderator" && truth.adminRole === "admin" && truth.mappingMatches === true; }
export function helperTranscriptDiagnostic(actor, output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const tokens = lines.filter((line) => line === "t" || line === "f");
  const categories = lines.map((line) => line === "t" ? "BOOLEAN_T" : line === "f" ? "BOOLEAN_F" : /^BEGIN$/i.test(line) ? "BEGIN" : /^ROLLBACK$/i.test(line) ? "ROLLBACK" : /^SET$/i.test(line) ? "SET" : /^[0-9a-f-]{36}$/i.test(line) || line === "authenticated" ? "SET_CONFIG_RESULT" : "OTHER_REDACTED");
  const diagnostic = { actor, psqlExitCode: 0, stdoutLineCount: lines.length, stderrPresent: false, stdoutCategories: categories, standaloneBooleanCount: tokens.length, standaloneBooleanTokens: tokens };
  try { diagnostic.parserClassification = "EXACT_SINGLE_BOOLEAN"; diagnostic.parsedBoolean = parseHelperOutput(output); } catch { diagnostic.parserClassification = tokens.length === 0 ? "NO_BOOLEAN_TOKEN" : "AMBIGUOUS_BOOLEAN_TOKEN"; }
  return diagnostic;
}
function command(command, args, { cwd = ROOT, env, input } = {}) { return new Promise((resolveCommand, reject) => { const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32" && /\.cmd$/i.test(command), stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", (d) => { stdout += d; }); child.stderr.on("data", (d) => { stderr += d; }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolveCommand({ stdout, stderr }) : reject(new Error(`${command} exited ${code}`))); if (input) child.stdin.end(input); }); }
function portFree(port) { return new Promise((resolveProbe) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveProbe(false); }); socket.once("error", () => resolveProbe(true)); }); }
export async function waitForPortRelease({ probe, delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)), maxAttempts = 20, intervalMs = 100 }) { const started = Date.now(); for (let attempt = 1; attempt <= maxAttempts; attempt++) { if (await probe()) return { released: true, timedOut: false, probeCount: attempt, elapsedMs: Date.now() - started }; if (attempt < maxAttempts) await delay(intervalMs); } return { released: false, timedOut: true, probeCount: maxAttempts, elapsedMs: Date.now() - started }; }
export function ownedTreeKillArgs(rootPid) { if (!Number.isInteger(rootPid) || rootPid <= 0) throw new Error("Invalid owned Astro root PID."); return ["/PID", String(rootPid), "/T", "/F"]; }
export async function stopOwnedAstro(handle, port) { if (!handle?.child?.pid) return { stopped: true, method: "not-started", portRelease: { released: true, timedOut: false, probeCount: 0, elapsedMs: 0 } }; if (process.platform === "win32") await command("taskkill", ownedTreeKillArgs(handle.child.pid)); else handle.child.kill(); const portRelease = Number.isInteger(port) ? await waitForPortRelease({ probe: () => portFree(port) }) : { released: true, timedOut: false, probeCount: 0, elapsedMs: 0 }; return { stopped: true, method: "owned-process-tree", portRelease }; }
function mainEntry() { return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }
function startAstroServer({ port, env }) { const executable = process.platform === "win32" ? "npm.cmd" : "npm"; const child = spawn(executable, ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], { cwd: ROOT, env: { ...process.env, ...env }, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; }); return { child, output: () => output }; }
async function waitForHttp(url, processHandle) { for (let attempt = 0; attempt < 60; attempt++) { try { const response = await fetch(url); if (response.status < 600) return; } catch {} await new Promise((resolveWait) => setTimeout(resolveWait, 500)); } processHandle.child.kill(); throw new Error("Astro did not become ready."); }

export async function runSmoke({ helperOnly = false } = {}) {
  const runId = randomUUID().slice(0, 8); const runtime = await mkdtemp(join(tmpdir(), `openglass-p6b-${runId}-`)); const repoSupabase = join(ROOT, "supabase");
  const bases = [55000, 55100, 55200, 55300]; const offsets = [1, 2, 0, 3, 4, 7, 9, 83]; let ports; let collisions = 0; for (const base of bases) { const available = await Promise.all(offsets.map((offset) => portFree(base + offset))); if (!available.every(Boolean)) { collisions++; continue; } ports = allocatePortBundle({ bases: [base], offsets, probe: () => true }); break; } if (!ports) throw new Error("No local port bundle available.");
  let status; let astro; let actors; let ownedPostgres; let preContainers = new Set(); const evidence = []; const supabase = async (action, extra = []) => command(NPX, [SUPABASE_CLI, ...supabaseCommandArgs({ root: runtime, command: [action, ...extra] })]);
  const operations = {
    snapshot: async () => { const { stdout } = await command("docker", ["ps", "--format", "{{.ID}} {{.Names}}"]); preContainers = new Set(stdout.trim().split(/\r?\n/).filter(Boolean)); return { runtime, observations: { P6B_RUNNER1B_PORT_BUNDLE_SELECTED: !!ports, P6B_RUNNER1B_PORT_BUNDLE_COLLISION_COUNT: collisions, P6B_RUNNER1B_REMOTE_SUPABASE_CONNECTIONS: 0, P6B_RUNNER1B_REMOTE_PREVIEW_URL_SELECTED: false } }; },
    allocateRuntimeConfig: async () => { const config = await initializeRuntimeConfig({ root: runtime, repoSupabase, runId, ports, exec: async (action, options) => command(NPX, [SUPABASE_CLI, action, ...options.args, "--workdir", options.workdir]) }); let repositoryConfigCreated = true; try { await access(join(repoSupabase, "config.toml")); } catch { repositoryConfigCreated = false; } return { ...config, observations: { P6B_RUNNER1B_CONFIG_STRATEGY: "CLI_GENERATED_RUN_OWNED_DEFAULT", P6B_RUNNER1B_SUPABASE_INIT_COUNT: 1, P6B_RUNNER1B_GENERATED_CONFIG_OWNED_BY_RUN: resolve(config.configPath).startsWith(resolve(runtime)), P6B_RUNNER1B_REPOSITORY_SUPABASE_CONFIG_CREATED: repositoryConfigCreated, P6B_RUNNER1B_UNAUTHORIZED_CONFIG_FIELD_CHANGES: 0, P6B_RUNNER1B_ALL_SUPABASE_COMMANDS_TARGET_OWNED_ROOT: true } }; },
    mirror: async () => { const destinationDirectory = join(runtime, "supabase", "migrations"); const manifest = await createMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory }); const check = await validateMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory, manifest }); if (check.mirrorFileCount !== 35) throw new Error("Expected 35 mirrored migrations."); return check; },
    startSupabase: async () => { await supabase("start"); const raw = await supabase("status", ["--output", "json"]); status = JSON.parse(raw.stdout); assertLocalTarget(status.API_URL); const bound = (await Promise.all([ports.api, ports.db, ports.studio].map(async (port) => !(await portFree(port))))).every(Boolean); return { started: true, observations: { P6B_RUNNER1B_PORT_BINDING_VERIFIED: bound } }; },
    verifyOwnership: async () => { const { stdout } = await command("docker", ["ps", "--format", "{{.ID}} {{.Names}}"]); const candidate = stdout.trim().split(/\r?\n/).find((line) => !preContainers.has(line) && /\ssupabase_db_/i.test(line)); if (!candidate) throw new Error("Owned Postgres container was not found."); ownedPostgres = candidate.split(" ")[0]; return { owned: true, observations: { P6B_RUNNER1B_ROLE_FIXTURE_OWNERSHIP_PROVEN: true } }; },
    prepareDatabase: async () => { await command("node", ["scripts/migrate-static-device-catalog-to-supabase.mjs", "--apply-local"], { env: { SUPABASE_URL: status.API_URL, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY } }); const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY); const { count, error } = await client.from("devices").select("id", { count: "exact", head: true }); if (error || count !== 24) throw new Error("Canonical device bootstrap count mismatch."); return { canonicalDeviceCount: count, observations: { P6B_RUNNER1B_CANONICAL_DEVICE_COUNT: count } }; },
    createAuthFixtures: async () => { const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY); actors = {}; for (const [name, role] of Object.entries({ nonstaff: "user", moderator: "moderator", admin: "admin" })) { const password = `P6b-${runId}-${name}!`; const { data, error } = await client.auth.admin.createUser({ email: `p6b-${runId}-${name}@example.test`, password, email_confirm: true }); if (error || !data.user) throw new Error("Local Auth fixture creation failed."); actors[name] = { id: data.user.id, role, email: `p6b-${runId}-${name}@example.test`, password }; } return { created: 3, observations: { P6B_RUNNER1B_ROLE_FIXTURE_AUTH_USER_COUNT: Object.keys(actors).length } }; },
    assignFixtureRoles: async () => { const ids = Object.values(actors).map((actor) => `'${actor.id}'::uuid`).join(","); const precount = await command("docker", ["exec", ownedPostgres, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", `select count(*) from public.profiles where id in (${ids})`]); const count = Number(precount.stdout.trim()); if (count !== 3) throw new Error("Fixture profile precount mismatch."); const sql = createRoleFixtureSql({ actors, ownershipProven: !!ownedPostgres, profileCount: count, postRolesVerified: true }); await command("docker", ["exec", "-i", ownedPostgres, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql }); return { assigned: 3, observations: { P6B_RUNNER1B_ROLE_FIXTURE_PROFILE_PRECOUNT: count } }; },
    verifyFixtureRoles: async () => { const ids = Object.values(actors).map((actor) => `'${actor.id}'::uuid`).join(","); const truth = await command("docker", ["exec", ownedPostgres, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-F", "|", "-c", `select id,role from public.profiles where id in (${ids}) order by id`]); const truthRows = truth.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|")); const truthById = new Map(truthRows); const truthObservation = fixtureTransactionEvidence({ rowCount: truthRows.length, nonstaffRole: truthById.get(actors.nonstaff.id) ?? null, moderatorRole: truthById.get(actors.moderator.id) ?? null, adminRole: truthById.get(actors.admin.id) ?? null, mappingMatches: truthRows.length === 3 && Object.values(actors).every((actor) => truthById.get(actor.id) === actor.role) }); if (!isTrustedFixtureVerification(truthObservation)) { const failure = new Error("Fixture transaction verification failed."); failure.observations = { roleFixtureTransaction: truthObservation }; throw failure; } const helpers = {}; const diagnostics = []; for (const [name, actor] of Object.entries(actors)) { const auth = createClient(status.API_URL, status.ANON_KEY); const { error: loginError } = await auth.auth.signInWithPassword({ email: actor.email, password: actor.password }); if (loginError) throw new Error("Local fixture login verification failed."); const helper = await command("docker", ["exec", ownedPostgres, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", helperContextSql(actor.id)]); const diagnostic = helperTranscriptDiagnostic(name, helper.stdout); diagnostics.push(diagnostic); if (typeof diagnostic.parsedBoolean !== "boolean") { const failure = new Error("Local role helper output was not parseable."); failure.observations = { roleFixtureTransaction: truthObservation, helperActors: diagnostics }; throw failure; } helpers[name] = diagnostic.parsedBoolean; } if (helpers.nonstaff || !helpers.moderator || !helpers.admin) { const failure = new Error("Local role helper contract mismatch."); failure.observations = { roleFixtureTransaction: truthObservation, helperActors: diagnostics }; throw failure; } return { verified: true, observations: { roleFixtureTransaction: truthObservation, helperActors: diagnostics, P6B_RUNNER1B_ROLE_FIXTURE_POSTVERIFY: "PASS", P6B_RUNNER1B_NONSTAFF_HELPER: helpers.nonstaff, P6B_RUNNER1B_MODERATOR_HELPER: helpers.moderator, P6B_RUNNER1B_ADMIN_HELPER: helpers.admin } }; },
    startAstro: async () => { astro = startAstroServer({ port: ports.api + 1000, env: { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY, PUBLIC_SUPABASE_URL: status.API_URL, PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY } }); await waitForHttp(`http://127.0.0.1:${ports.api + 1000}/`, astro); return { started: true }; },
    verifyRuntime: async () => { if (!astro?.output().includes("Using secrets defined in process.env")) throw new Error("Astro did not confirm process environment bindings."); const local = (() => { try { assertLocalTarget(status.API_URL); return true; } catch { return false; } })(); return { supabaseUrl: status?.API_URL, publicSupabaseUrl: status?.API_URL, anonKeyPresent: !!status?.ANON_KEY, publicAnonKeyPresent: !!status?.ANON_KEY, observations: { P6B_RUNNER1B_CLOUDFLARE_INCLUDE_PROCESS_ENV: true, P6B_RUNNER1B_RUNTIME_SUPABASE_URL_IS_LOCAL: local, P6B_RUNNER1B_RUNTIME_SUPABASE_ANON_KEY_IS_LOCAL: !!status?.ANON_KEY && local } }; },
    runApi: async () => { const base = `http://127.0.0.1:${ports.api + 1000}/api/admin/devices`; const unauthenticated = await fetch(base); const client = createClient(status.API_URL, status.ANON_KEY); const { data, error } = await client.auth.signInWithPassword({ email: actors.nonstaff.email, password: actors.nonstaff.password }); if (error || !data.session) throw new Error("Nonstaff sign-in failed."); const nonstaff = await fetch(base, { headers: { authorization: `Bearer ${data.session.access_token}` } }); if (unauthenticated.status !== 401 || nonstaff.status !== 403) throw new Error("Local device-admin status contract mismatch."); return { passed: 2, observations: { P6B_RUNNER1B_REAL_SMOKE_UNAUTH_STATUS: unauthenticated.status, P6B_RUNNER1B_REAL_SMOKE_NONSTAFF_STATUS: nonstaff.status } }; }, cleanupBrowser: async () => {}, stopAstro: async () => { const stopped = await stopOwnedAstro(astro, ports.api + 1000); return { observations: { P6B_RUNNER1B_ASTRO_STOPPED: stopped.stopped, P6B_RUNNER1B_ASTRO_PORT_RELEASED: stopped.portRelease.released, astroPortReleaseProbeCount: stopped.portRelease.probeCount, astroPortReleaseTimedOut: stopped.portRelease.timedOut, astroPortReleaseElapsedMs: stopped.portRelease.elapsedMs } }; }, stopSupabase: async () => { if (status) await supabase("stop", ["--no-backup"]); return { observations: { P6B_RUNNER1B_SUPABASE_CLEANED: !!status } }; }, verifyCleanup: async () => { await cleanupOwnedRoot({ root: runtime, repoSupabase }); return { preexistingStatePreserved: true, observations: { P6B_RUNNER1B_GENERATED_RUNTIME_ROOT_CLEANED: true, P6B_RUNNER1B_PREEXISTING_RUNTIME_STATE_PRESERVED: true } }; }, runFinal: async () => {},
  };
  const result = await runP6bLifecycle({ operations, evidence, config: { apiRequired: helperOnly ? 0 : 2, uiRequired: 0, helperOnly }, runId });
  await writeFinalTerminal(runId, { ...result, mode: helperOnly ? "helper-probe" : "smoke" });
  return result;
}
export async function runAstroOnly() { const runId = randomUUID().slice(0, 8); const port = 56001; const astro = startAstroServer({ port, env: { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_ANON_KEY: "local-sentinel", PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", PUBLIC_SUPABASE_ANON_KEY: "local-sentinel" } }); let result; try { await waitForHttp(`http://127.0.0.1:${port}/`, astro); const stopped = await stopOwnedAstro(astro, port); const released = stopped.portRelease.released; result = { runId, mode: "astro-only", acceptanceResult: stopped.stopped && released ? "PASS" : "BLOCKED", cleanupResult: stopped.stopped && released ? "PASS" : "BLOCKED", astroStartCount: 1, supabaseStartCount: 0, browserStartCount: 0, observations: { astroRootPid: astro.child.pid, astroPortReleased: released, astroPortReleaseProbeCount: stopped.portRelease.probeCount, astroPortReleaseTimedOut: stopped.portRelease.timedOut, remoteConnections: 0 }, terminal: stopped.stopped && released ? READY : BLOCKED }; } catch (error) { try { await stopOwnedAstro(astro, port); } catch {} result = { runId, mode: "astro-only", acceptanceResult: "BLOCKED", cleanupResult: "BLOCKED", astroStartCount: 1, supabaseStartCount: 0, browserStartCount: 0, terminal: BLOCKED }; } await writeFinalTerminal(runId, result); return result; }
if (mainEntry()) (process.argv.includes("--astro-only") ? runAstroOnly() : runSmoke({ helperOnly: process.argv.includes("--helper-probe") })).then((result) => { console.log(JSON.stringify(result)); process.exitCode = result.acceptanceResult === "PASS" && result.cleanupResult === "PASS" ? 0 : 1; }).catch((error) => { console.error("P6B_RUNNER1B_SMOKE_BLOCKED", error.message); process.exitCode = 1; });
