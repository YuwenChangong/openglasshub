import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const moduleExtensions = new Set([".js", ".mjs"]);
const cloudTargetPattern = /(?:\.supabase\.co|\.pages\.dev|cloudflare|supavisor)/i;
const forbiddenPayloadPattern = /(?:Exit code:|```|<\/?(?:tool|system|assistant)>)/i;

export const R5L_LOCAL_ONLY_MARKERS = [
  "LOCAL_R5L_ONLY",
  "NO_CLOUD_DEPLOYMENT",
  "NO_PRODUCTION_BINDINGS",
  "NOT_A_PRODUCTION_WRANGLER_CONFIG",
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  }));
  return children.flat();
}

function requireLoopbackUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid local URL`);
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`${name} must target loopback only`);
  }
}

export async function inspectBuiltWorker({ repositoryRoot, artifactDirectory = path.join(repositoryRoot, "dist", "_worker.js") }) {
  const files = await walk(artifactDirectory);
  const entryCandidates = files.filter((file) => ["index.js", "index.mjs"].includes(path.basename(file)) && path.dirname(file) === artifactDirectory);
  if (entryCandidates.length === 0) throw new Error("R5L generated Worker entrypoint is missing");
  if (entryCandidates.length !== 1) throw new Error("R5L generated Worker entrypoint is ambiguous");

  const entrypoint = entryCandidates[0];
  const modules = files
    .filter((file) => moduleExtensions.has(path.extname(file)))
    .sort((left, right) => left === entrypoint ? -1 : right === entrypoint ? 1 : left.localeCompare(right))
    .map((file) => ({ type: "ESModule", path: file }));
  if (modules.length < 2) throw new Error("R5L expected a generated multi-module Worker graph");

  const source = await Promise.all(modules.map(async ({ path: file }) => [file, await readFile(file, "utf8")]));
  const nodeFsImports = source.flatMap(([file, text]) => /(?:node:)?fs(?:\/promises)?/.test(text) ? [file] : []);
  return { artifactDirectory, entrypoint, modules, nodeFsImports };
}

export async function readCheckedInCompatibilityDate(configurationPath) {
  const source = await readFile(configurationPath, "utf8");
  const match = source.match(/^compatibility_date\s*=\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})"\s*$/m);
  if (!match) throw new Error("R5L checked-in compatibility_date is missing");
  return match[1];
}

export function validateLocalBindings(bindings) {
  for (const marker of R5L_LOCAL_ONLY_MARKERS) assert.equal(bindings[marker], "true", `missing ${marker}`);
  for (const name of ["SUPABASE_URL", "PUBLIC_SUPABASE_URL"]) requireLoopbackUrl(bindings[name], name);
  for (const [name, value] of Object.entries(bindings)) {
    if (typeof value !== "string") throw new Error(`${name} must be a string binding`);
    if (cloudTargetPattern.test(value)) throw new Error(`${name} contains a cloud or production target`);
  }
  if (!bindings.SUPABASE_ANON_KEY || !bindings.SUPABASE_SERVICE_ROLE_KEY) throw new Error("R5L local Supabase bindings are required");
}

export async function assertBrowserAssetsHaveNoServiceRole(repositoryRoot) {
  const assetsDirectory = path.join(repositoryRoot, "dist", "_astro");
  const files = await walk(assetsDirectory).catch(() => []);
  for (const file of files.filter((candidate) => /\.(?:js|mjs|css|html)$/.test(candidate))) {
    const text = await readFile(file, "utf8");
    if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(text)) throw new Error(`browser asset exposes service-role material: ${path.basename(file)}`);
  }
}

export async function startBuiltPagesWorker({ repositoryRoot, bindings, port, configurationPath = path.join(repositoryRoot, "wrangler.toml") }) {
  validateLocalBindings(bindings);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("R5L Worker requires an explicit loopback port");
  await assertPortAvailable(port);
  await assertBrowserAssetsHaveNoServiceRole(repositoryRoot);
  const inspected = await inspectBuiltWorker({ repositoryRoot });
  const compatibilityDate = await readCheckedInCompatibilityDate(configurationPath);
  const runtime = new Miniflare({
    modules: inspected.modules,
    modulesRoot: inspected.artifactDirectory,
    compatibilityDate,
    host: "127.0.0.1",
    port,
    kvNamespaces: ["SESSION"],
    bindings,
  });

  try {
    await runtime.getBindings();
    const origin = `http://127.0.0.1:${port}`;
    requireLoopbackUrl(origin, "R5L Worker origin");
    return {
      origin,
      inspected,
      async dispose() { await runtime.dispose(); },
    };
  } catch (error) {
    await runtime.dispose().catch(() => {});
    throw error;
  }
}

export async function waitForWorkerResponse(origin, { pathname = "/api/__r5l_readiness__", timeoutMs = 8_000, pollMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}${pathname}`);
      if (response.status > 0 && response.status < 600) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`R5L Worker readiness timed out${lastError ? `: ${lastError.message}` : ""}`);
}

export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

export function assertRawSqlPayload(payload) {
  if (forbiddenPayloadPattern.test(payload)) throw new Error("R5L raw payload guard rejected formatted transport content");
}

export const harnessModulePath = fileURLToPath(import.meta.url);
