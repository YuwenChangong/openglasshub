import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_RUNTIME_IMPORT = /(from\s+["']pg["']|require\(["']pg["']\)|release-b-production-postgres-adapter)/;
const SCANNED_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".toml",
]);

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function isInside(parent, target) {
  const candidate = relative(parent, target);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

function isAllowedQaPath(root, target) {
  return isInside(resolve(root, "scripts", "qa"), target);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function maybeFile(path) {
  try {
    return (await stat(path)).isFile() ? [resolve(path)] : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function collectFiles(directory, files = []) {
  if (!(await pathExists(directory))) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(target, files);
    else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(resolve(target));
  }
  return files;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function resolveWithin(root, base, candidate) {
  if (typeof candidate !== "string" || candidate.trim() === "") return null;
  const target = resolve(base, candidate);
  return isInside(root, target) ? target : null;
}

async function collectBuildManifestInputs(root) {
  const files = new Set();
  const deployPointerPath = resolve(root, ".wrangler", "deploy", "config.json");
  const generatedWranglerPath = resolve(root, "dist", "server", "wrangler.json");

  for (const file of await maybeFile(deployPointerPath)) files.add(file);
  for (const file of await maybeFile(generatedWranglerPath)) files.add(file);

  const pointer = await readJsonIfPresent(deployPointerPath);
  const pointedConfig = resolveWithin(root, resolve(deployPointerPath, ".."), pointer?.configPath);
  if (pointedConfig) {
    for (const file of await maybeFile(pointedConfig)) files.add(file);
  }

  for (const configPath of [...files].filter((file) => file.endsWith("wrangler.json"))) {
    const config = await readJsonIfPresent(configPath);
    const entrypoint = resolveWithin(root, resolve(configPath, ".."), config?.main);
    if (entrypoint) {
      for (const file of await maybeFile(entrypoint)) files.add(file);
    }
  }

  return [...files];
}

export async function scanReleaseBPostgresAdapterRuntimeIsolation(root) {
  const absoluteRoot = resolve(root);
  const files = new Set([
    ...(await collectFiles(resolve(absoluteRoot, "src"))),
    ...(await collectFiles(resolve(absoluteRoot, "functions"))),
    ...(await maybeFile(resolve(absoluteRoot, "astro.config.mjs"))),
    ...(await maybeFile(resolve(absoluteRoot, "astro.config.js"))),
    ...(await maybeFile(resolve(absoluteRoot, "astro.config.ts"))),
    ...(await maybeFile(resolve(absoluteRoot, "wrangler.toml"))),
    ...(await collectBuildManifestInputs(absoluteRoot)),
  ]);

  const violations = [];
  for (const file of [...files].sort()) {
    if (isAllowedQaPath(absoluteRoot, file)) continue;
    const source = await readFile(file, "utf8");
    if (FORBIDDEN_RUNTIME_IMPORT.test(source)) violations.push(toPosix(relative(absoluteRoot, file)));
  }

  return Object.freeze({
    scannedFiles: files.size,
    violations: Object.freeze(violations),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..", "..");
  const result = await scanReleaseBPostgresAdapterRuntimeIsolation(root);
  assert.deepEqual(result.violations, [], "Release B PostgreSQL adapter and pg must stay out of runtime imports");
  console.log(JSON.stringify({
    status: "PASS",
    guard: "release-b-postgres-adapter-runtime-isolation",
    scannedFiles: result.scannedFiles,
  }, null, 2));
}
