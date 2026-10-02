import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";

async function runOwnedSsrServer() {
  assert.ok(process.send, "Local SSR server must be owned through IPC");
  const originalFetch = globalThis.fetch;
  function assertLoopback(input) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      process.send({ type: "external-request" });
      throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
    }
  }
  globalThis.fetch = (input, init) => { assertLoopback(input); return originalFetch(input, init); };
  const OriginalWebSocket = globalThis.WebSocket;
  if (OriginalWebSocket) globalThis.WebSocket = class extends OriginalWebSocket {
    constructor(url, protocols) { assertLoopback(url); super(url, protocols); }
  };
  const { dev } = await import("astro");
  const { default: cloudflare } = await import("@astrojs/cloudflare");
  let server, stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await server?.stop();
    process.exit(0);
  }
  process.on("message", (message) => { if (message?.type === "stop") void stop(); });
  process.on("disconnect", () => { void stop(); });
  process.on("SIGTERM", () => { void stop(); });
  try {
    server = await dev({ root: new URL("../", import.meta.url), logLevel: "error", devToolbar: { enabled: false },
      server: { host: "127.0.0.1", port: 0 },
      adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }),
      vite: { plugins: [{ name: "owned-public-legal-no-auth", enforce: "pre", resolveId(id) {
        if (/(?:^|\/)supabase-browser(?:\.ts)?$/.test(id)) return "\0owned-public-legal-no-auth";
      }, load(id) { if (id === "\0owned-public-legal-no-auth") return "export const createBrowserSupabaseClient=()=>null; export const syncBrowserRealtimeAuth=async()=>null;"; } }] } });
    if (stopping) { await server.stop(); return; }
    process.send({ type: "ready", port: server.address.port });
  } catch (error) {
    process.send({ type: "startup-failure", detail: error?.code ?? error?.name ?? "UNKNOWN" });
    await server?.stop();
    process.exit(1);
  }
}

if (process.argv.includes("--owned-public-legal-ssr")) {
  await runOwnedSsrServer();
} else {

const root = process.cwd();
const contactModule = await import("../src/lib/public-legal-contacts.ts");
const contactKeys = Object.keys(contactModule.PUBLIC_LEGAL_CONTACT_ENV);

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveInstalledAstroCli() {
  const packageDirectory = path.join(root, "node_modules", "astro");
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.astro;
  assert.ok(typeof bin === "string" && bin.length > 0 && bin.trim().length > 0 && !bin.includes("\0"), "Installed Astro package must declare a usable local bin");
  assert.ok(!path.isAbsolute(bin) && !path.win32.isAbsolute(bin), "Astro bin must be package-relative");
  const candidate = path.resolve(packageDirectory, bin);
  assert.ok(isInside(packageDirectory, candidate), "Astro bin must stay inside its installed package");
  const [realDirectory, realCli] = await Promise.all([realpath(packageDirectory), realpath(candidate)]);
  assert.ok(isInside(realDirectory, realCli), "Astro bin must not resolve outside its installed package");
  assert.ok((await stat(realCli)).isFile(), "Installed Astro CLI must be an existing file");
  return realCli;
}

function productionVars(source) {
  const match = source.match(/\[env\.production\.vars\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/);
  assert.ok(match, "wrangler.toml must contain env.production.vars");
  return Object.fromEntries([...match[1].matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/gm)].map(([, key, value]) => [key, value]));
}

const wrangler = await readFile(path.join(root, "wrangler.toml"), "utf8");
const production = productionVars(wrangler);
const preview = wrangler.match(/\[env\.preview\.vars\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/)?.[1] ?? "";

for (const key of contactKeys) {
  const envName = contactModule.PUBLIC_LEGAL_CONTACT_ENV[key];
  assert.equal(production[envName], contactModule.PUBLIC_LEGAL_CONTACTS[key], `${envName} must match the checked-in legal source`);
  assert.ok(!preview.includes(`${envName} =`), `${envName} must not change Preview`);
}

contactModule.validatePublicLegalContacts(contactModule.PUBLIC_LEGAL_CONTACTS);
for (const [key, value] of [
  ["support", ""],
  ["support", "  "],
  ["support", "todo@example.invalid"],
  ["support", "not-an-email"],
  ["operator", "<script>"],
]) {
  assert.throws(() => contactModule.validatePublicLegalContacts({ ...contactModule.PUBLIC_LEGAL_CONTACTS, [key]: value }), /Invalid public legal/);
}

for (const route of ["src/pages/terms/index.astro", "src/pages/privacy/index.astro", "src/pages/community-guidelines/index.astro", "src/pages/contact/index.astro"]) {
  const source = await readFile(path.join(root, route), "utf8");
  assert.match(source, /showPublicContacts=\{true\}/, `${route} must render the shared public contacts`);
}

const legalPage = await readFile(path.join(root, "src/components/legal/LegalPage.astro"), "utf8");
assert.match(legalPage, /PUBLIC_LEGAL_CONTACTS/);
assert.doesNotMatch(legalPage, /set:html=\{PUBLIC_LEGAL_CONTACTS/);
assert.doesNotMatch(await readFile(path.join(root, "src/lib/legal-policy.ts"), "utf8"), /import\.meta\.env/);

const environment = preparePreferenceRunEnvironment(process.env);
environment.ASTRO_TELEMETRY_DISABLED = "1";
environment.ASTRO_DISABLE_UPDATE_CHECK = "true";
environment.CLOUDFLARE_CF_FETCH_ENABLED = "false";
execFileSync(process.execPath, [await resolveInstalledAstroCli(), "build"], { cwd: root, stdio: "pipe", env: environment });
const child = fork(fileURLToPath(import.meta.url), ["--owned-public-legal-ssr"], {
  cwd: root, env: environment, execPath: process.execPath, stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let externalRequestCount = 0, failureDetail = "";
child.stdout.on("data", (chunk) => { failureDetail = (failureDetail + chunk).slice(-4000); });
child.stderr.on("data", (chunk) => { failureDetail = (failureDetail + chunk).slice(-4000); });
child.on("message", (message) => { if (message?.type === "external-request") externalRequestCount++; });
const closed = once(child, "close");
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("LOCAL_SSR_START_TIMEOUT")), 30000);
    function finish(error, port) {
      clearTimeout(timer);
      child.off("message", onMessage); child.off("error", onError); child.off("exit", onExit);
      if (error) reject(error); else resolve(port);
    }
    function onError(error) { finish(error); }
    function onExit() { finish(new Error("LOCAL_SSR_EXIT_BEFORE_READY")); }
    function onMessage(message) {
      if (message?.type === "external-request") finish(new Error("UNEXPECTED_EXTERNAL_REQUEST"));
      if (message?.type === "startup-failure") finish(new Error(`LOCAL_SSR_START_FAILURE:${message.detail}`));
      if (message?.type === "ready") {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) finish(new Error("LOCAL_SSR_INVALID_PORT"));
        else finish(null, message.port);
      }
    }
    child.on("message", onMessage); child.on("error", onError); child.on("exit", onExit);
  });
  const origin = `http://127.0.0.1:${port}`;
  const ready = await fetch(`${origin}/terms/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30000) });
  assert.equal(ready.status, 200, "Local SSR readiness must succeed");
  for (const route of ["/terms/", "/privacy/", "/community-guidelines/"]) {
    const response = await fetch(origin + route, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { "accept-language": "en" } });
    assert.equal(response.status, 200, `${route} must return HTTP 200`);
    const contentType = response.headers.get("content-type");
    if (contentType) assert.match(contentType, /text\/html/i, `${route} must return HTML`);
    const html = await response.text();
    assert.ok(html.length > 0 && /<html\b/i.test(html), `${route} must return nonempty HTML`);
    for (const value of Object.values(contactModule.PUBLIC_LEGAL_CONTACTS)) assert.ok(html.includes(value), `${route} must contain every public legal value`);
    assert.doesNotMatch(html, /pending configuration|待配置|TODO|TBD|example\.com/i, `${route} must not contain legal fallback text`);
    assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|PUBLIC_[A-Z0-9_]*SERVICE_ROLE/i, `${route} must not expose a service-role binding`);
    assert.equal(externalRequestCount, 0, "No external server request is allowed");
  }
} catch (error) {
  if (/LOCAL_SSR_(?:START|EXIT|INVALID)/.test(error.message)) console.error(`LOCAL_SSR_START_DETAIL=${failureDetail}`);
  throw error;
} finally {
  if (child.connected) child.send({ type: "stop" });
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await closed;
  clearTimeout(killTimer);
}
assert.equal(externalRequestCount, 0, "No external server request is allowed");
console.log(JSON.stringify({ status: "PASS", mechanism: "checked-in-public-legal-config-local-astro-dev-ssr", productionValueCount: contactKeys.length, previewLegalValues: 0, renderedRoutes: 3, externalRequestCount,
  astroCliResolution: "PASS", localBuild: "PASS", localSsrStart: "PASS", renderedContacts: "PASS", secretLeakAssertions: "PASS", transport: "OWNED_ASTRO_DEV_CLOUDFLARE_LOCAL_SSR", origin: "LOOPBACK" }));
}
