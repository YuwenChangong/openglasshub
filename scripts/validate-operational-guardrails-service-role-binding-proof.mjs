import { readFile } from "node:fs/promises";
import { inspectServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";

const [input] = process.argv.slice(2);
if (!input) throw new Error("usage: node scripts/validate-operational-guardrails-service-role-binding-proof.mjs <metadata-proof.json>");
const packet = JSON.parse(await readFile(input, "utf8"));
const result = inspectServiceRoleBindingPacket(packet);
console.log(JSON.stringify(result));
if (result.classification !== "SECRET_BINDING_PRESENT") process.exitCode = 1;
