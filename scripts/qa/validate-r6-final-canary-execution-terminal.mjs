import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateFinalExecutionTerminal } from "./r6-final-canary-execution-contract.mjs";

try {
  validateFinalExecutionTerminal(JSON.parse(await readFile(process.argv[2], "utf8")));
  process.stdout.write("R6_FINAL_CANARY_EXECUTION_TERMINAL_OK\n");
} catch (error) {
  process.stderr.write(`${error?.code ?? "R6_FINAL_EXECUTION_TERMINAL_INVALID"}\n`);
  process.exitCode = 1;
}
