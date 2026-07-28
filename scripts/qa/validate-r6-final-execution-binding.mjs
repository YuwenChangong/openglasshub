import { readAndValidateFinalExecutionBinding } from "./r6-final-execution-binding.mjs";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--binding" || args[2] !== "--sha256") process.exitCode = 1;
else {
  try {
    const binding = await readAndValidateFinalExecutionBinding(args[1], args[3]);
    process.stdout.write(`${JSON.stringify(binding)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || "R6_FINAL_EXECUTION_BINDING_INVALID"}\n`);
    process.exitCode = 1;
  }
}
