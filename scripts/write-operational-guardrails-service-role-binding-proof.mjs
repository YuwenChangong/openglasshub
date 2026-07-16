import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  BINDING_NAME,
  CLOUDFLARE_PAGES_PROJECT,
  ENVIRONMENTS,
  PACKET_VERSION,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";
import { validateServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const root = resolve(".");
const environment = args.environment;
const output = args.output;
const sourceCommit = args["source-commit"];

if (!ENVIRONMENTS.includes(environment)) throw new Error("environment must be preview or production");
if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? "")) throw new Error("source-commit must be a 40-character Git SHA");
if (!output || !isAbsolute(output) || !relative(root, resolve(output)).startsWith("..")) throw new Error("output must be an absolute path outside the repository");

const packet = {
  packet_version: PACKET_VERSION,
  source_commit: sourceCommit,
  cloudflare_pages_project: CLOUDFLARE_PAGES_PROJECT,
  environment,
  expected_binding_name: BINDING_NAME,
  source_binding_name: BINDING_NAME,
  binding_exists: true,
  binding_storage_kind: "secret",
  exact_binding_count: 1,
  conflicting_binding_names: [],
  browser_exposed_binding_count: 0,
  operator_evidence_scope: "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED",
};
validateServiceRoleBindingPacket(packet);
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ packetVersion: PACKET_VERSION, environment, binding: BINDING_NAME, outputWritten: true, metadataOnly: true }));
