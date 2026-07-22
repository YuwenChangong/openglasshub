import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateProjectTerminalResult } from "./run-cloudflare-pages-project-metadata-preparation.mjs";

function fail() { throw Object.assign(new Error("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE"), { code: "R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE" }); }
function parseFlags(argv) {
  if (argv.length !== 4 || argv[0] !== "--terminal-result-path" || argv[2] !== "--tooling-commit" || !argv[1] || !/^[a-f0-9]{40}$/.test(argv[3])) fail();
  return { resultPath: path.resolve(argv[1]), toolingCommit: argv[3] };
}

export async function validateProjectTerminalResultFile(argv = process.argv.slice(2)) {
  const { resultPath, toolingCommit } = parseFlags(argv);
  let result;
  try { result = JSON.parse(await readFile(resultPath, "utf8")); } catch { fail(); }
  return validateProjectTerminalResult(result, { resultPath, toolingCommit });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await validateProjectTerminalResultFile();
    process.stdout.write(`R6_PAGES_PROJECT_TERMINAL_RESULT_${result.kind.toUpperCase()}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? "R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE"}\n`);
    process.exitCode = 1;
  }
}
