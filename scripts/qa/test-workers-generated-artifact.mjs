import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTE_SOURCE_EXTENSIONS = new Set([".astro", ".js", ".mjs", ".ts", ".tsx"]);

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function assertInsideDist(root, target, code) {
  const dist = resolve(root, "dist");
  const fromDist = relative(dist, target);
  if (fromDist === "" || fromDist === ".." || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
    throw new Error(code);
  }
}

async function assertFile(path, code) {
  try {
    if (!(await stat(path)).isFile()) throw new Error(code);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(code);
    throw error;
  }
}

async function assertDirectory(path, code) {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(code);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(code);
    throw error;
  }
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(code);
    if (error instanceof SyntaxError) throw new Error(`${code}_INVALID_JSON`);
    throw error;
  }
}

async function collectRouteSources(root, directory = resolve(root, "src", "pages"), routes = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) await collectRouteSources(root, target, routes);
    else if (entry.isFile() && ROUTE_SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      routes.push({
        path: toPosix(relative(root, target)),
        source: await readFile(target, "utf8"),
      });
    }
  }
  return routes;
}

function countMatching(routes, predicate) {
  return routes.filter(({ path }) => predicate(path)).length;
}

export async function validateWorkersGeneratedArtifact(root) {
  const absoluteRoot = resolve(root);
  const pointerPath = resolve(absoluteRoot, ".wrangler", "deploy", "config.json");
  const pointer = await readJson(pointerPath, "WORKER_DEPLOY_POINTER_MISSING");
  if (typeof pointer?.configPath !== "string" || pointer.configPath.trim() === "") {
    throw new Error("WORKER_SELECTED_CONFIG_MISSING");
  }

  const selectedConfigPath = resolve(dirname(pointerPath), pointer.configPath);
  assertInsideDist(absoluteRoot, selectedConfigPath, "WORKER_SELECTED_CONFIG_OUTSIDE_DIST");
  await assertFile(selectedConfigPath, "WORKER_SELECTED_CONFIG_MISSING");
  const config = await readJson(selectedConfigPath, "WORKER_SELECTED_CONFIG_MISSING");

  if (Object.hasOwn(config, "pages_build_output_dir")) throw new Error("WORKER_CONFIG_HAS_PAGES_BUILD_OUTPUT_DIR");
  if (typeof config.main !== "string" || config.main.trim() === "") throw new Error("WORKER_ENTRYPOINT_UNDECLARED");
  if (config.assets?.binding !== "ASSETS" || typeof config.assets?.directory !== "string" || config.assets.directory.trim() === "") {
    throw new Error("WORKER_ASSETS_UNDECLARED");
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) throw new Error("WORKER_MODULE_RULES_UNDECLARED");

  const entrypointPath = resolve(dirname(selectedConfigPath), config.main);
  assertInsideDist(absoluteRoot, entrypointPath, "WORKER_ENTRYPOINT_OUTSIDE_DIST");
  await assertFile(entrypointPath, "WORKER_ENTRYPOINT_MISSING");

  const assetsPath = resolve(dirname(selectedConfigPath), config.assets.directory);
  assertInsideDist(absoluteRoot, assetsPath, "WORKER_ASSETS_OUTSIDE_DIST");
  await assertDirectory(assetsPath, "WORKER_ASSETS_MISSING");

  const routes = await collectRouteSources(absoluteRoot);
  const representativeCoverage = {
    admin: countMatching(routes, (path) => path.startsWith("src/pages/admin/") || path.startsWith("src/pages/api/admin/")),
    devices: countMatching(routes, (path) => path.startsWith("src/pages/devices/") || path.startsWith("src/pages/api/devices/")),
    forum: countMatching(routes, (path) => path.startsWith("src/pages/forum/") || path.startsWith("src/pages/api/forum/")),
    gazeLauncher: countMatching(routes, (path) => path.startsWith("src/pages/gaze-launcher/")),
    news: countMatching(routes, (path) => path.startsWith("src/pages/news/") || path.startsWith("src/pages/api/news")),
    notifications: countMatching(routes, (path) => path.startsWith("src/pages/notifications/") || path.includes("/notifications")),
    products: countMatching(routes, (path) => path.startsWith("src/pages/products/") || path.startsWith("src/pages/api/products/")),
    profiles: countMatching(routes, (path) => /^(?:src\/pages\/(?:u|users|me)\/|src\/pages\/api\/users\/)/.test(path)),
  };
  const api = countMatching(routes, (path) => path.startsWith("src/pages/api/"));
  const prerenderFalse = routes.filter(({ source }) => /export\s+const\s+prerender\s*=\s*false\b/.test(source)).length;

  if (api === 0) throw new Error("WORKER_SOURCE_API_COVERAGE_MISSING");
  if (prerenderFalse === 0) throw new Error("WORKER_SOURCE_PRERENDER_FALSE_COVERAGE_MISSING");
  for (const [area, count] of Object.entries(representativeCoverage)) {
    if (count === 0) throw new Error(`WORKER_SOURCE_${area.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_COVERAGE_MISSING`);
  }

  return {
    schemaVersion: "cloudflare-workers-generated-artifact/v1",
    artifact: {
      assetsDirectory: toPosix(relative(absoluteRoot, assetsPath)),
      entrypoint: toPosix(relative(absoluteRoot, entrypointPath)),
      pointer: toPosix(relative(absoluteRoot, pointerPath)),
      selectedConfig: toPosix(relative(absoluteRoot, selectedConfigPath)),
    },
    routes: {
      api,
      prerenderFalse,
      source: routes.length,
      representativeCoverage,
    },
  };
}

async function fixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "openglass-workers-artifact-"));

try {
  await fixtureFile(fixtureRoot, ".wrangler/deploy/config.json", JSON.stringify({
    configPath: "../../dist/server/wrangler.json",
    auxiliaryWorkers: [],
  }));
  await fixtureFile(fixtureRoot, "dist/server/wrangler.json", JSON.stringify({
    main: "./entry.mjs",
    assets: { binding: "ASSETS", directory: "../client" },
    rules: [{ type: "ESModule", globs: ["**/*.mjs"] }],
    vars: { PRIVATE_FIXTURE_SECRET: "must-not-appear-in-report" },
  }));
  await fixtureFile(fixtureRoot, "dist/server/entry.mjs", "export default { fetch() {} };\n");
  await fixtureFile(fixtureRoot, "dist/client/index.html", "<!doctype html>\n");

  const representativeRoutes = [
    "src/pages/api/forum/posts.ts",
    "src/pages/forum/index.astro",
    "src/pages/devices/index.astro",
    "src/pages/products/index.astro",
    "src/pages/news/index.astro",
    "src/pages/u/[username].astro",
    "src/pages/notifications/index.astro",
    "src/pages/admin/index.astro",
    "src/pages/gaze-launcher/index.astro",
  ];
  for (const route of representativeRoutes) {
    await fixtureFile(fixtureRoot, route, "---\nexport const prerender = false;\n---\nprivate-server-code-sentinel\n");
  }

  const report = await validateWorkersGeneratedArtifact(fixtureRoot);
  assert.deepEqual(report, {
    schemaVersion: "cloudflare-workers-generated-artifact/v1",
    artifact: {
      assetsDirectory: "dist/client",
      entrypoint: "dist/server/entry.mjs",
      pointer: ".wrangler/deploy/config.json",
      selectedConfig: "dist/server/wrangler.json",
    },
    routes: {
      api: 1,
      prerenderFalse: 9,
      source: 9,
      representativeCoverage: {
        admin: 1,
        devices: 1,
        forum: 2,
        gazeLauncher: 1,
        news: 1,
        notifications: 1,
        products: 1,
        profiles: 1,
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(report), /must-not-appear|private-server-code-sentinel/i);

  await rm(join(fixtureRoot, "dist", "server", "entry.mjs"));
  await assert.rejects(
    () => validateWorkersGeneratedArtifact(fixtureRoot),
    /WORKER_ENTRYPOINT_MISSING/,
    "a selected config whose Worker entrypoint is absent must fail closed",
  );

} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..", "..");
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts?.["test:workers-artifact"],
    "node scripts/qa/test-workers-generated-artifact.mjs",
    "package.json must expose the focused generated Worker artifact test",
  );
  console.log(JSON.stringify(await validateWorkersGeneratedArtifact(root), null, 2));
  console.log("workers-generated-artifact: PASS");
}
