import { readFile } from "node:fs/promises";
import { validateLegalNonproductionTargetBinding } from "../lib/legal-nonproduction-target-binding.mjs";

const path = process.argv[2];
if (!path) throw new Error("R6_LOCAL_NONPRODUCTION_TARGET_VALIDATOR_INPUT_REQUIRED");
const binding = JSON.parse(await readFile(path, "utf8"));
process.stdout.write(`${JSON.stringify(validateLegalNonproductionTargetBinding(binding))}\n`);
