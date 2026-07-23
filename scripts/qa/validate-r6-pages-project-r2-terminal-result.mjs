import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateProjectR2TerminalResult } from "./run-cloudflare-pages-project-r2-metadata-preparation.mjs";

function fail() { throw Object.assign(new Error("R6_PAGES_PROJECT_R2_TERMINAL_CONTRACT_UNSAFE"), { code: "R6_PAGES_PROJECT_R2_TERMINAL_CONTRACT_UNSAFE" }); }
export async function validateProjectR2TerminalResultFile(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== "--terminal-result-path" || argv[2] !== "--tooling-commit" || !argv[1] || !/^[a-f0-9]{40}$/.test(argv[3])) fail();
  let value; try { value = JSON.parse(await readFile(path.resolve(argv[1]), "utf8")); } catch { fail(); }
  return validateProjectR2TerminalResult(value, { resultPath: path.resolve(argv[1]), toolingCommit: argv[3] });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { const result = await validateProjectR2TerminalResultFile(); process.stdout.write(`R6_PAGES_PROJECT_R2_TERMINAL_RESULT_${result.kind.toUpperCase()}\n`); } catch (error) { process.stderr.write(`${error?.code ?? "R6_PAGES_PROJECT_R2_TERMINAL_CONTRACT_UNSAFE"}\n`); process.exitCode = 1; } }
