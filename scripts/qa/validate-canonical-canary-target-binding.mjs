import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";

export async function validateCanonicalCanaryTargetBindingFile(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  validateCanonicalCanaryTargetBinding(value);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try {
    await validateCanonicalCanaryTargetBindingFile(process.argv[2]);
    process.stdout.write("QA_CANARY_TARGET_BINDING_OK\n");
  } catch {
    process.stderr.write("QA_CANARY_TARGET_BINDING_INVALID\n");
    process.exitCode = 1;
  }
}
