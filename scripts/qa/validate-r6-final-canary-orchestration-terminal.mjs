import { readFile } from "node:fs/promises";
import { validateFinalOrchestrationTerminal } from "./r6-final-canary-execution-contract.mjs";
try { validateFinalOrchestrationTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_FINAL_CANARY_ORCHESTRATION_TERMINAL_OK\n"); }
catch (error) { process.stderr.write(`${error?.code ?? "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
