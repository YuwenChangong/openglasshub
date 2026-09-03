import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ASTRO_CHECK_BASELINE_COMMIT, createBaselineManifest, parseAstroCheckOutput } from "./astro-check-baseline-core.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
assert.ok(inputPath && outputPath, "Usage: node scripts/build-astro-check-baseline.mjs <astro-output> <manifest-output>");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), ASTRO_CHECK_BASELINE_COMMIT, `Baseline manifest may only be built from ${ASTRO_CHECK_BASELINE_COMMIT.slice(0, 8)}`);

const root = process.cwd();
const output = await readFile(inputPath, "utf8");
const parsed = parseAstroCheckOutput(output, { repositoryRoot: root });
const resolved = new Map();
const resolveGitBlob = (relativePath) => {
  if (resolved.has(relativePath)) return resolved.get(relativePath);
  const objectId = execFileSync("git", ["rev-parse", `${ASTRO_CHECK_BASELINE_COMMIT}:${relativePath}`], { cwd: root, encoding: "utf8" }).trim();
  const blob = execFileSync("git", ["cat-file", "blob", objectId], { cwd: root });
  const value = { objectId, sha256: createHash("sha256").update(blob).digest("hex") };
  resolved.set(relativePath, value);
  return value;
};

const manifest = createBaselineManifest({ parsed, resolveGitBlob, nodeVersion: process.version });
const resolvedOutput = path.resolve(root, outputPath);
await mkdir(path.dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", baselineCommit: manifest.baselineCommit, errors: manifest.totals.errors, affectedPaths: manifest.totals.affectedPaths, output: outputPath }));
