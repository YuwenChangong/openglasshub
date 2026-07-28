import { readFile } from "node:fs/promises";
import { validateFinalPostflight } from "./r6-final-canary-execution-contract.mjs";
try { validateFinalPostflight(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_FINAL_CANARY_POSTFLIGHT_OK\n"); }
catch (error) { process.stderr.write(`${error?.code ?? "R6_FINAL_POSTFLIGHT_INVALID"}\n`); process.exitCode = 1; }
