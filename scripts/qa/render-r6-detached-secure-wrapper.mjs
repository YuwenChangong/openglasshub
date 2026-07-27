import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function fail(code) { throw Object.assign(new Error(code), { code }); }
function args(argv) {
  if (argv.length !== 8) fail("R6_WRAPPER_RENDER_INPUT_INVALID");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  for (const key of ["--source", "--destination", "--worktree", "--v3-commit"]) if (!values.get(key)) fail("R6_WRAPPER_RENDER_INPUT_INVALID");
  return Object.fromEntries(values);
}
const values = args(process.argv.slice(2));
const source = path.resolve(values["--source"]); const destination = path.resolve(values["--destination"]); const worktree = path.resolve(values["--worktree"]); const commit = values["--v3-commit"];
if (!/^[a-f0-9]{40}$/.test(commit)) fail("R6_WRAPPER_RENDER_INPUT_INVALID");
const head = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== commit) fail("R6_WRAPPER_RENDER_COMMIT_MISMATCH");
const relative = "scripts/qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";
const runner = path.join(worktree, relative);
const [template, runnerBytes] = await Promise.all([readFile(source, "utf8"), readFile(runner)]);
const raw = createHash("sha256").update(runnerBytes).digest("hex");
const blob = execFileSync("git", ["-C", worktree, "rev-parse", `${commit}:${relative}`], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(blob)) fail("R6_WRAPPER_RENDER_BLOB_INVALID");
let rendered = template;
for (const [name, value] of [["V3FinalCommitBinding", commit], ["V3RuntimeRawSha256Binding", raw], ["V3GitBlobBinding", blob]]) {
  const pattern = new RegExp(`(\\$script:${name}\\s*=\\s*')[a-f0-9]+(')`);
  if (!pattern.test(rendered)) fail("R6_WRAPPER_RENDER_TEMPLATE_INVALID");
  rendered = rendered.replace(pattern, `$1${value}$2`);
}
await writeFile(destination, rendered, "utf8");
process.stdout.write(`${JSON.stringify({ destination, sha256: createHash("sha256").update(rendered).digest("hex"), v3Commit: commit, runnerSha256: raw, runnerBlob: blob })}\n`);
