import { readFile } from "node:fs/promises";
import { validateServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";

const [input] = process.argv.slice(2);
if (!input) throw new Error("usage: node scripts/validate-operational-guardrails-service-role-binding-proof.mjs <metadata-proof.json>");
const packet = JSON.parse(await readFile(input, "utf8"));
console.log(JSON.stringify(validateServiceRoleBindingPacket(packet)));
