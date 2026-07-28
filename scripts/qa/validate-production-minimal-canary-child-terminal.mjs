import { readFile } from "node:fs/promises";
import { validateMinimalCanaryChildTerminal } from "./run-production-minimal-canary.mjs";

try {
  validateMinimalCanaryChildTerminal(JSON.parse(await readFile(process.argv[2], "utf8")));
  process.stdout.write("QA_MINIMAL_CANARY_CHILD_TERMINAL_OK\n");
} catch (error) {
  process.stderr.write(`${error?.message ?? "QA_MINIMAL_CANARY_CHILD_TERMINAL_INVALID"}\n`);
  process.exitCode = 1;
}
