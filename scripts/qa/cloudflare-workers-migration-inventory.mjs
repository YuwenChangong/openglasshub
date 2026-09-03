import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_PAGES_URL = "https://openglasshub.pages.dev";
const ROUTE_SOURCE_EXTENSIONS = new Set([".astro", ".js", ".mjs", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const PROVIDER_RECEIPT_KEYS = new Set(["accountSubdomain", "pagesProjects", "workerScripts"]);
const CREDENTIAL_KEY_PATTERN = /(api[_-]?key|authorization|credential|password|secret|token|value)/i;
const JWT_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

function sorted(items) {
  return [...items].sort((left, right) => String(left).localeCompare(String(right)));
}

async function readTextIfPresent(path) {
  try {
    const bytes = await readFile(path);
    if (bytes.includes(0)) return null;
    const source = bytes.toString("utf8");
    return source.includes("\uFFFD") ? null : source;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function findTextFiles(root, current = root, results = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await findTextFiles(root, path, results);
      continue;
    }
    if (entry.isFile() && await readTextIfPresent(path) !== null) {
      results.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return results;
}

function environmentForSection(section) {
  return section.match(/^env\.([^.]+)\./)?.[1] ?? "root";
}

function collectTomlInventory(source) {
  const keyNames = new Set();
  const bindings = [];
  const environmentVariableNames = [];
  let section = "";

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const table = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (table) {
      section = table[1].trim();
      if (!section.includes(".")) keyNames.add(section);
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (!assignment) continue;
    const key = assignment[1];
    if (!section) keyNames.add(key);
    if (section === "vars" || section.endsWith(".vars")) {
      environmentVariableNames.push({ environment: environmentForSection(section), name: key });
      continue;
    }
    const type = section.endsWith("r2_buckets") ? "R2"
      : section.endsWith("kv_namespaces") ? "KV"
      : section.endsWith("d1_databases") ? "D1"
      : section.endsWith("durable_objects.bindings") ? "DURABLE_OBJECT"
      : section.endsWith("services") ? "SERVICE"
      : null;
    const nameKey = type === "DURABLE_OBJECT" ? "name" : "binding";
    if (type && key === nameKey) {
      const name = line.match(new RegExp(`^${nameKey}\\s*=\\s*["']([^"']+)["']`))?.[1];
      if (name) bindings.push({ environment: environmentForSection(section), name, type });
    }
  }

  return { keyNames: sorted(keyNames), bindings, environmentVariableNames };
}

function collectJsonConfigInventory(source) {
  if (!source) return { bindings: [], keyNames: [] };
  const config = JSON.parse(source);
  const bindings = [];
  for (const [property, type] of [["r2_buckets", "R2"], ["kv_namespaces", "KV"], ["d1_databases", "D1"], ["services", "SERVICE"]]) {
    for (const binding of Array.isArray(config[property]) ? config[property] : []) {
      if (typeof binding?.binding === "string") bindings.push({ environment: "generated", name: binding.binding, type });
    }
  }
  for (const binding of Array.isArray(config.durable_objects?.bindings) ? config.durable_objects.bindings : []) {
    if (typeof binding?.name === "string") bindings.push({ environment: "generated", name: binding.name, type: "DURABLE_OBJECT" });
  }
  return { bindings, keyNames: sorted(Object.keys(config)) };
}

function isHistoricalDocument(source) {
  const openingLine = source.trimStart().split(/\r?\n/, 1)[0] ?? "";
  return /^(?:#.*\b(?:archived|historical|release receipt)\b|(?:document )?status:\s*(?:archived|historical)\b|prior release\b)/i.test(openingLine);
}

function classifyPagesUrlLocation(path, source) {
  if (path.startsWith("docs/") && isHistoricalDocument(source)) return "KEEP_UNCHANGED";
  if (path.startsWith("docs/") || path.startsWith("tests/")) return "UNKNOWN_REQUIRES_REVIEW";
  if (path === "scripts/smoke-production.mjs" || path === "scripts/post-launch-check.mjs" || path === "package.json") return "ADD_NEW_URL_FIRST";
  if (path.startsWith("supabase/") || /supabase|oauth|webhook|cors/i.test(path)) return "EXTERNAL_PROVIDER_WRITE_REQUIRED";
  if (path === "astro.config.mjs" || path.startsWith("public/") || path.startsWith("src/")) return "SWITCH_AFTER_WORKER_PASS";
  return "UNKNOWN_REQUIRES_REVIEW";
}

function isRuntimeSourcePath(path) {
  return path.startsWith("src/") || path.startsWith("functions/");
}

function isRouteSourcePath(path) {
  return ROUTE_SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase());
}

function collectRuntimeUse(path, source, runtime) {
  if (!isRuntimeSourcePath(path)) return;
  if (/from\s*["']cloudflare:workers["']/.test(source)) runtime.cloudflareWorkersImportPaths.push(path);
  for (const match of source.matchAll(/(?<!\.)\benv\??\.\s*([A-Z][A-Z0-9_]*)/g)) runtime.sourceBindingNames.add(match[1]);
  for (const match of source.matchAll(/\b[A-Za-z_$][\w$]*\s*\(\s*env\s*,\s*["']([A-Z][A-Z0-9_]*)["']/g)) runtime.sourceBindingNames.add(match[1]);
  if (/\bD1Database\b|(?<!\.)\benv\??\.[A-Z][A-Z0-9_]*\.prepare\s*\(/.test(source)) runtime.optionalBindingUse.D1.push(path);
  if (/\bDurableObject(?:Namespace|Stub|State)?\b|(?<!\.)\benv\??\.[A-Z][A-Z0-9_]*\.(?:idFromName|idFromString|newUniqueId)\s*\(/.test(source)) runtime.optionalBindingUse.DURABLE_OBJECT.push(path);
  if (/\b(?:Fetcher|ServiceBinding)\b|(?<!\.)\benv\??\.[A-Z][A-Z0-9_]*\.fetch\s*\(/.test(source)) runtime.optionalBindingUse.SERVICE.push(path);
}

function finalizeRuntimeUse(runtime, bindings) {
  return {
    cloudflareWorkersImportPaths: sorted(runtime.cloudflareWorkersImportPaths),
    optionalBindingUse: Object.fromEntries(Object.entries(runtime.optionalBindingUse).map(([type, paths]) => [type, {
      configuredNames: sorted(new Set(bindings.filter((binding) => binding.type === type).map((binding) => binding.name))),
      sourcePaths: sorted(new Set(paths)),
      status: paths.length > 0 || bindings.some((binding) => binding.type === type) ? "PRESENT" : "ABSENT",
    }])),
    sourceBindingNames: sorted(runtime.sourceBindingNames),
  };
}

function countOccurrences(source, token) {
  return source.split(token).length - 1;
}

function rejectCredentialLikeValue(value) {
  if (typeof value === "string" && JWT_LIKE_PATTERN.test(value)) {
    throw new Error("Provider receipt must remain value-blind; credential-like value rejected.");
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectCredentialLikeValue(item);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) throw new Error("Provider receipt must remain value-blind; sensitive field rejected.");
      rejectCredentialLikeValue(nested);
    }
  }
}

export function sanitizeProviderReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Provider receipt must be an object.");
  for (const key of Object.keys(receipt)) {
    if (!PROVIDER_RECEIPT_KEYS.has(key)) throw new Error("Provider receipt must remain value-blind; unapproved field rejected.");
  }
  rejectCredentialLikeValue(receipt);
  return {
    schemaVersion: "cloudflare-workers-provider-receipt/v1",
    accountSubdomain: typeof receipt.accountSubdomain === "string" ? receipt.accountSubdomain : null,
    workerScripts: Array.isArray(receipt.workerScripts)
      ? receipt.workerScripts.map(({ name, previewsEnabled, workersDevEnabled }) => ({
          name: typeof name === "string" ? name : null,
          previewsEnabled: previewsEnabled === true,
          workersDevEnabled: workersDevEnabled === true,
        }))
      : [],
    pagesProjects: Array.isArray(receipt.pagesProjects)
      ? receipt.pagesProjects.map(({ buildMetadataKeyNames, name }) => ({
          buildMetadataKeyNames: sorted(Array.isArray(buildMetadataKeyNames) ? buildMetadataKeyNames.filter((key) => typeof key === "string") : []),
          name: typeof name === "string" ? name : null,
        }))
      : [],
  };
}

export async function collectRepositoryInventory(root) {
  const absoluteRoot = resolve(root);
  const toml = (await readTextIfPresent(join(absoluteRoot, "wrangler.toml"))) ?? "";
  const tomlInventory = collectTomlInventory(toml);
  const generated = collectJsonConfigInventory(await readTextIfPresent(join(absoluteRoot, "dist", "server", "wrangler.json")));
  const pagesUrlOccurrences = [];
  const routes = { apiRouteFiles: 0, nonApiRouteFiles: 0, pageFiles: 0 };
  const runtime = {
    cloudflareWorkersImportPaths: [],
    optionalBindingUse: { D1: [], DURABLE_OBJECT: [], SERVICE: [] },
    sourceBindingNames: new Set(),
  };

  for (const path of sorted(await findTextFiles(absoluteRoot))) {
    const source = await readTextIfPresent(join(absoluteRoot, path));
    if (source?.includes(LEGACY_PAGES_URL)) {
      pagesUrlOccurrences.push({
        classification: classifyPagesUrlLocation(path, source),
        count: countOccurrences(source, LEGACY_PAGES_URL),
        path,
      });
    }
    if (source !== null) collectRuntimeUse(path, source, runtime);
    if (path.startsWith("src/pages/") && isRouteSourcePath(path)) {
      routes.pageFiles += 1;
      if (path.startsWith("src/pages/api/")) routes.apiRouteFiles += 1;
      else routes.nonApiRouteFiles += 1;
    }
  }

  const bindingKeys = new Set();
  const bindings = [];
  for (const binding of [...tomlInventory.bindings, ...generated.bindings]) {
    const key = `${binding.environment}:${binding.type}:${binding.name}`;
    if (!bindingKeys.has(key)) {
      bindingKeys.add(key);
      bindings.push(binding);
    }
  }

  return {
    schemaVersion: "cloudflare-workers-migration-repository-inventory/v1",
    config: {
      generatedConfigKeyNames: generated.keyNames,
      keyNames: tomlInventory.keyNames,
    },
    bindings: bindings.sort((left, right) => `${left.environment}:${left.type}:${left.name}`.localeCompare(`${right.environment}:${right.type}:${right.name}`)),
    environmentVariableNames: tomlInventory.environmentVariableNames.sort((left, right) => `${left.environment}:${left.name}`.localeCompare(`${right.environment}:${right.name}`)),
    pagesUrlOccurrences,
    routes,
    runtime: finalizeRuntimeUse(runtime, bindings),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = await collectRepositoryInventory(process.cwd());
  console.log(JSON.stringify(inventory, null, 2));
}
