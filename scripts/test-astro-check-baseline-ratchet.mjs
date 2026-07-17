import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ASTRO_CHECK_BASELINE_COMMIT, ASTRO_CHECK_BASELINE_TOOLCHAIN, compareDiagnostics, parseAstroCheckOutput } from "./astro-check-baseline-core.mjs";

const root = process.cwd();
const version = (packageName) => JSON.parse(readFileSync(path.join(root, "node_modules", packageName, "package.json"))).version;
function readFileSync(file) { return execFileSync(process.execPath, ["-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8'))`], { encoding: "utf8" }); }
for (const [name, expected] of Object.entries({ astro: ASTRO_CHECK_BASELINE_TOOLCHAIN.astro, "@astrojs/check": ASTRO_CHECK_BASELINE_TOOLCHAIN.check, typescript: ASTRO_CHECK_BASELINE_TOOLCHAIN.typescript })) {
  assert.equal(version(name), expected, `Local ${name} version differs from the reviewed Astro ratchet toolchain`);
}

const manifestPath = path.join(root, "scripts", "fixtures", "astro-check-baseline-cd87f54.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const result = spawnSync(process.execPath, [path.join(root, "node_modules", "astro", "astro.js"), "check"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.ok(result.error === undefined, `Astro check process failed to start: ${result.error?.message ?? "unknown error"}`);
assert.equal(result.status, 1, "Frozen baseline debt expects Astro check to exit 1 until existing diagnostics are remediated");
const parsed = parseAstroCheckOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`, { repositoryRoot: root });
const changed = new Set([
  ...execFileSync("git", ["diff", "--name-only", `${ASTRO_CHECK_BASELINE_COMMIT}..HEAD`], { cwd: root, encoding: "utf8" }).split(/\r?\n/),
  ...execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).split(/\r?\n/),
  ...execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).split(/\r?\n/),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split(/\r?\n/),
].filter(Boolean));
const comparison = compareDiagnostics({
  baseline: manifest,
  current: parsed,
  candidateChangedPaths: changed,
  resolveCandidateGitObject: (relativePath) => execFileSync("git", ["hash-object", `--path=${relativePath}`, relativePath], { cwd: root, encoding: "utf8" }).trim(),
});
assert.ok(comparison.pass, JSON.stringify({ newDiagnostics: comparison.newDiagnostics, changedPathErrors: comparison.changedPathErrors, baselineBlobChanges: comparison.baselineBlobChanges }, null, 2));
console.log(JSON.stringify({ status: "PASS", baselineErrors: comparison.baselineErrors, currentErrors: comparison.currentErrors, removedErrors: comparison.removedDiagnostics.length, newErrors: comparison.newDiagnostics.length, changedPathErrors: comparison.changedPathErrors.length, baselineBlobChanges: comparison.baselineBlobChanges.length }));
