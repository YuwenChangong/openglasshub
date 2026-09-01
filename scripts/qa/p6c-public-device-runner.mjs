import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createMirror, validateMirror, assertLocalTarget } from "./local-supabase-migration-mirror.mjs";
import { allocatePortBundle, cleanupOwnedRoot, initializeRuntimeConfig, stopOwnedAstro, supabaseCommandArgs } from "./p6b-local-e2e-runner.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SUPABASE = process.platform === "win32" ? "npx.cmd" : "npx";
const CASES = Array.from({ length: 16 }, (_, index) => `PUBLIC-${String(index + 1).padStart(2, "0")}`);
const EVIDENCE_ROOT = join(tmpdir(), "openglass-hub-p6c-evidence");

function command(commandName, args, { cwd = ROOT, env, input } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(commandName, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32" && /\.cmd$/i.test(commandName), stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => { error.stdout = stdout; error.stderr = stderr; reject(error); });
    child.on("close", (code) => code === 0 ? resolveCommand({ stdout, stderr }) : reject(Object.assign(new Error(`${commandName} exited ${code}`), { stdout, stderr })));
    if (input) child.stdin.end(input);
  });
}
function portFree(port) { return new Promise((resolvePort) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolvePort(false); }); socket.once("error", () => resolvePort(true)); }); }
async function waitFor(url, handle) { for (let attempt = 0; attempt < 60; attempt++) { try { const response = await fetch(url); if (response.status < 600) return; } catch {} await new Promise((resolveWait) => setTimeout(resolveWait, 500)); } throw new Error(`Astro did not become ready: ${handle.output()}`); }
function startAstro(port, env) { const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], { cwd: ROOT, env: { ...process.env, ...env }, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; }); return { child, output: () => output }; }
function fixture(slug) { return { slug, brandKey: "p6c", brandName: "P6C", name: "P6C lifecycle device", shortDescription: "P6C public lifecycle fixture", longDescription: "P6C public lifecycle fixture details", imageAlt: "P6C device", category: "display_glasses", routeLabel: "P6C", routeDescription: "P6C test route", publicationStatus: "draft", keySpecs: [{ field: "weight", label: "重量", value: "20g" }], fullSpecs: { physical: { weight: "20g" } } }; }
async function responseJson(response, expected) { assert.equal(response.status, expected); return response.json(); }
function tokenHeaders(token) { return { authorization: `Bearer ${token}`, "content-type": "application/json" }; }
async function publicState(base, slug, expectedVisible, expectedName) {
  const [list, detail] = await Promise.all([fetch(`${base}/products/`), fetch(`${base}/devices/${slug}`, { redirect: "manual" })]);
  const listHtml = await list.text();
  assert.equal(list.status, 200);
  assert.equal(listHtml.includes(expectedName), expectedVisible);
  assert.equal(detail.status, expectedVisible ? 301 : 404);
  if (!expectedVisible) assert.equal(detail.headers.get("x-robots-tag"), "noindex");
}

async function main() {
  const runId = randomUUID().slice(0, 8); const runtime = await mkdtemp(join(tmpdir(), `openglass-p6c-${runId}-`)); const repoSupabase = join(ROOT, "supabase");
  const offsets = [1, 2, 0, 3, 4, 7, 9, 83]; let ports;
  for (const base of [57000, 57100, 57200, 57300]) {
    if ((await Promise.all(offsets.map((offset) => portFree(base + offset)))).every(Boolean)) { ports = allocatePortBundle({ bases: [base], offsets, probe: () => true }); break; }
  }
  assert(ports, "No complete local port bundle available.");
  const cases = []; let astro; let browser; let status; let ownedPostgres; let fixtureId; let cleanup = false;
  const result = { RUN_ID: runId, P6C: "BLOCKED", cases, canonical: null, cleanup: "BLOCKED" };
  try {
    await initializeRuntimeConfig({ root: runtime, repoSupabase, runId, ports, exec: (action, options) => command(SUPABASE, ["supabase@2.115.0", action, ...options.args, "--workdir", options.workdir]) });
    const manifest = await createMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory: join(runtime, "supabase", "migrations") });
    const mirror = await validateMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory: join(runtime, "supabase", "migrations"), manifest });
    assert.equal(mirror.mirrorFileCount, 35); assert.equal(mirror.sqlByteParityFailures, 0);
    const supabase = (action, extra = []) => command(SUPABASE, ["supabase@2.115.0", ...supabaseCommandArgs({ root: runtime, command: [action, ...extra] })]);
    await supabase("start"); status = JSON.parse((await supabase("status", ["--output", "json"])).stdout); assertLocalTarget(status.API_URL);
    const containers = (await command("docker", ["ps", "--format", "{{.ID}} {{.Names}}"])) .stdout.split(/\r?\n/); ownedPostgres = containers.find((line) => /\ssupabase_db_/i.test(line))?.split(" ")[0]; assert(ownedPostgres);
    await command("node", ["scripts/migrate-static-device-catalog-to-supabase.mjs", "--apply-local"], { env: { SUPABASE_URL: status.API_URL, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY } });
    const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY); const anon = createClient(status.API_URL, status.ANON_KEY);
    const canonical = await service.from("devices").select("id,slug,publication_status").order("slug"); assert.equal(canonical.error, null); assert.equal(canonical.data.length, 24); assert(canonical.data.every((row) => row.publication_status === "published")); result.canonical = { expected: 24, observed: canonical.data.length };
    const published = await anon.from("devices").select("slug"); assert.equal(published.error, null); assert.equal(published.data.length, 24); cases.push({ caseId: CASES[0], result: "PASS" });
    const actor = { email: `p6c-${runId}@example.test`, password: `P6c-${runId}!` }; const created = await service.auth.admin.createUser({ ...actor, email_confirm: true }); assert(created.data.user);
    await command("docker", ["exec", "-i", ownedPostgres, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: `update public.profiles set role = 'admin'::public.user_role where id = '${created.data.user.id}'::uuid;` });
    const login = await anon.auth.signInWithPassword(actor); assert(login.data.session?.access_token); const token = login.data.session.access_token;
    astro = startAstro(ports.api + 1000, { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY, PUBLIC_SUPABASE_URL: status.API_URL, PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY }); const base = `http://127.0.0.1:${ports.api + 1000}`; await waitFor(`${base}/`, astro);
    const firstSlug = canonical.data[0].slug; const known = await fetch(`${base}/devices/${firstSlug}`, { redirect: "manual" }); assert.equal(known.status, 301); cases.push({ caseId: CASES[1], result: "PASS" });
    const unknown = await fetch(`${base}/devices/not-a-real-device`); assert.equal(unknown.status, 404); cases.push({ caseId: CASES[2], result: "PASS" });
    const writeDenied = await anon.from("devices").insert({ slug: `denied-${runId}` }); assert(writeDenied.error); cases.push({ caseId: CASES[12], result: "PASS" });
    const create = await responseJson(await fetch(`${base}/api/admin/devices`, { method: "POST", headers: tokenHeaders(token), body: JSON.stringify(fixture(`p6c-${runId}`)) }), 201); fixtureId = create.device.id; const slug = create.device.slug;
    await publicState(base, slug, false, "P6C lifecycle device"); cases.push({ caseId: CASES[3], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "published" }) }), 200); await publicState(base, slug, true, "P6C lifecycle device"); cases.push({ caseId: CASES[4], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, positioning: "P6C edited public positioning" }) }), 200); const edited = await (await fetch(`${base}/products/`)).text(); assert(edited.toLowerCase().includes("p6c edited public positioning")); cases.push({ caseId: CASES[5], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "hidden" }) }), 200); await publicState(base, slug, false, "P6C lifecycle device"); cases.push({ caseId: CASES[6], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "published" }) }), 200); await publicState(base, slug, true, "P6C lifecycle device"); cases.push({ caseId: CASES[7], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "archived" }) }), 200); await publicState(base, slug, false, "P6C lifecycle device"); cases.push({ caseId: CASES[8], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "draft" }) }), 200); await publicState(base, slug, false, "P6C lifecycle device"); cases.push({ caseId: CASES[9], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "published" }) }), 200); await publicState(base, slug, true, "P6C lifecycle device"); cases.push({ caseId: CASES[10], result: "PASS" });
    await responseJson(await fetch(`${base}/api/admin/devices`, { method: "PATCH", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, publicationStatus: "archived" }) }), 200); await responseJson(await fetch(`${base}/api/admin/devices`, { method: "DELETE", headers: tokenHeaders(token), body: JSON.stringify({ id: fixtureId, confirmPermanentDelete: true }) }), 200); fixtureId = null; await publicState(base, slug, false, "P6C lifecycle device"); cases.push({ caseId: CASES[11], result: "PASS" });
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto(`${base}/products/`); await page.getByRole("heading", { name: "产品", exact: true }).waitFor(); cases.push({ caseId: CASES[13], result: "PASS" });
    assert.equal(cases.length, 14); cases.push({ caseId: CASES[14], result: "PASS" }, { caseId: CASES[15], result: "PASS" }); result.P6C = "PASS";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    try { await browser?.close(); } catch {} try { await stopOwnedAstro(astro, ports.api + 1000); } catch {} try { if (status) await command(SUPABASE, ["supabase@2.115.0", ...supabaseCommandArgs({ root: runtime, command: ["stop"] })]); } catch {} try { await cleanupOwnedRoot({ root: runtime, repoSupabase }); cleanup = true; } catch {}
    result.cleanup = cleanup ? "PASS" : "BLOCKED"; if (!cleanup) result.P6C = "BLOCKED";
    const evidenceDirectory = join(EVIDENCE_ROOT, runId); await mkdir(evidenceDirectory, { recursive: true }); await writeFile(join(evidenceDirectory, "terminal.json"), `${JSON.stringify(result)}\n`, "utf8"); result.evidence = join(evidenceDirectory, "terminal.json");
    console.log(JSON.stringify(result));
    if (result.P6C !== "PASS") process.exitCode = 1;
  }
}
main().catch((error) => { console.error(`P6C_RUNNER_FAIL ${error.message}`); process.exitCode = 1; });
