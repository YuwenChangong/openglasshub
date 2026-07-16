import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BINDING_NAME,
  CLASSIFICATIONS,
  CLOUDFLARE_PAGES_PROJECT,
  ENVIRONMENTS,
  PACKET_VERSION,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";
import { inspectServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";
import { resolveSafeProofOutputPath } from "./operational-guardrails-service-role-binding-proof-paths.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const root = resolve(".");
const environment = args.environment;
const output = args.output;
const sourceCommit = args["source-commit"];
const classification = args.classification;

if (!ENVIRONMENTS.includes(environment)) throw new Error("environment must be preview or production");
if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? "")) throw new Error("source-commit must be a 40-character Git SHA");
if (!CLASSIFICATIONS.includes(classification)) throw new Error("classification must be one approved metadata result");
if (!output) throw new Error("output must be an absolute path outside the repository");

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
    conflicting_binding_count: 0,
    browser_exposed_binding_count: 0,
    classification,
    operator_evidence_scope: "CLOUDFLARE_DASHBOARD_METADATA_ONLY_NO_VALUE_VIEWED",
};
if (classification === "BINDING_ABSENT") Object.assign(packet, { binding_exists: false, binding_storage_kind: "absent", exact_binding_count: 0 });
if (classification === "PLAINTEXT_BINDING_PRESENT") Object.assign(packet, { binding_storage_kind: "plaintext" });
if (classification === "CONFLICTING_BINDINGS_PRESENT") Object.assign(packet, { exact_binding_count: 2, conflicting_binding_count: 1 });
if (classification === "BROWSER_EXPOSURE_CONFLICT") Object.assign(packet, { browser_exposed_binding_count: 1 });
if (classification === "INSUFFICIENT_EVIDENCE") Object.assign(packet, { binding_exists: false, binding_storage_kind: "unknown", exact_binding_count: 0 });
inspectServiceRoleBindingPacket(packet);
const safeOutput = await resolveSafeProofOutputPath({ repositoryRoot: root, outputPath: output });
await writeFile(safeOutput, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ packetVersion: PACKET_VERSION, environment, binding: BINDING_NAME, classification, outputWritten: true, metadataOnly: true }));
