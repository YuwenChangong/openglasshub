import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { spawnSync } from "node:child_process";
import {
  BINDING_NAME,
  CLASSIFICATIONS,
  ENVIRONMENTS,
  packetForClassification,
  proofCases,
  validPacket,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";
import { inspectServiceRoleBindingPacket, validateServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";
import { isStrictlyOutsideRoot } from "./operational-guardrails-service-role-binding-proof-paths.mjs";

const files = {
  legal: "src/lib/server/legal-consent-repository.server.ts",
  moderation: "src/lib/server/moderation-notifications.server.ts",
  browser: "src/lib/supabase-browser.ts",
  rateLimit: "src/lib/server/rate-limit.ts",
  writer: "scripts/write-operational-guardrails-service-role-binding-proof.mjs",
  validator: "scripts/validate-operational-guardrails-service-role-binding-proof.mjs",
  core: "scripts/operational-guardrails-service-role-binding-proof-core.mjs",
  paths: "scripts/operational-guardrails-service-role-binding-proof-paths.mjs",
  runner: "scripts/run-operational-guardrails-service-role-binding-proof.ps1",
  identity: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-trusted-identity.md",
  readiness: "docs/ops/reconciliation/operational-guardrails-service-role-binding-r1-readiness.md",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])));

assert.equal(BINDING_NAME, "SUPABASE_SERVICE_ROLE_KEY");
assert.match(source.legal, /createLegalConsentServiceClient[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source.moderation, /createModerationNotificationServiceClient[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.browser, /SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.rateLimit, /SUPABASE_SERVICE_ROLE_KEY|createClient\(/);
assert.doesNotMatch(`${source.legal}\n${source.moderation}`, /console\.(?:log|warn|error).*SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source.identity, /EXISTING_BINDING_NAME_SOURCE_PROVEN/);
assert.match(source.readiness, /Local[\s\S]*CONFIGURATION_REQUIRED/);
assert.match(source.readiness, /Preview[\s\S]*BINDING_PROOF_REQUIRED/);
assert.match(source.readiness, /Production[\s\S]*BINDING_PROOF_REQUIRED/);
assert.match(source.readiness, /BLOCKED_RUNTIME_MIGRATION_REQUIRED/);

for (const environment of ENVIRONMENTS) assert.equal(validateServiceRoleBindingPacket(validPacket(environment)).environment, environment);
for (const classification of CLASSIFICATIONS) assert.equal(inspectServiceRoleBindingPacket(packetForClassification(classification)).classification, classification);
for (const packet of Object.values(proofCases)) assert.throws(() => validateServiceRoleBindingPacket(packet));
assert.throws(() => validateServiceRoleBindingPacket({ ...validPacket(), secret_value: "forbidden" }));
for (const text of [source.writer, source.validator, source.core, source.paths, source.runner]) assert.doesNotMatch(text, /fetch\(|https?:\/\/|wrangler|child_process|exec\(/i);
assert.match(source.writer, /flag: "wx"/);
assert.match(source.writer, /outside the repository/);
assert.match(source.writer, /classification must be one approved metadata result/);
assert.match(source.runner, /Proof writer failed\. The validator was not invoked/);
assert(source.runner.indexOf("& node $writer") < source.runner.indexOf("& node $validator"));

assert.equal(isStrictlyOutsideRoot("D:\\repo", "C:\\Users\\proof.json", win32), true, "different drive output must be outside");
assert.equal(isStrictlyOutsideRoot("D:\\repo", "D:\\outside\\proof.json", win32), true, "same-drive outside output must be outside");
assert.equal(isStrictlyOutsideRoot("D:\\repo", "D:\\repo\\proof.json", win32), false, "repository child must be rejected");
assert.equal(isStrictlyOutsideRoot("D:\\repo", "D:\\repo\\subdir\\proof.json", win32), false, "repository descendant must be rejected");
assert.equal(isStrictlyOutsideRoot("D:\\repo\\", "D:\\repo", win32), false, "repository root with trailing separator must be rejected");
assert.equal(isStrictlyOutsideRoot("D:\\repo", "D:\\repo\\subdir\\..\\proof.json", win32), false, "normalized traversal into repository must be rejected");
assert.equal(isStrictlyOutsideRoot("D:\\Repo", "d:\\OUTSIDE\\proof.json", win32), true, "drive letter case must not change containment");
assert.equal(isStrictlyOutsideRoot("D:\\Repo", "d:\\repo\\proof.json", win32), false, "path case must not bypass containment");
assert.equal(isStrictlyOutsideRoot("\\\\server\\share\\repo", "\\\\server\\other\\proof.json", win32), true, "UNC sibling share output must be outside");
assert.equal(isStrictlyOutsideRoot("/repo", "/tmp/proof.json"), true, "POSIX outside output must be accepted");
assert.equal(isStrictlyOutsideRoot("/repo", "relative/proof.json"), false, "relative output must be rejected");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "openglass-binding-proof-"));
const validOutput = join(temporaryDirectory, "absent.json");
const writerArgs = [
  "scripts/write-operational-guardrails-service-role-binding-proof.mjs",
  "--environment", "preview",
  "--classification", "BINDING_ABSENT",
  "--source-commit", "038d2c766d0a6935c6ebfbd94ae68cd61f7bf1a1",
  "--output", validOutput,
];
const writerRun = spawnSync(process.execPath, writerArgs, { encoding: "utf8" });
assert.equal(writerRun.status, 0, writerRun.stderr);
assert.equal(inspectServiceRoleBindingPacket(JSON.parse(await readFile(validOutput, "utf8"))).classification, "BINDING_ABSENT");
const validatorRun = spawnSync(process.execPath, ["scripts/validate-operational-guardrails-service-role-binding-proof.mjs", validOutput], { encoding: "utf8" });
assert.equal(validatorRun.status, 1, "BINDING_ABSENT validator result must fail closed");
assert.match(validatorRun.stdout, /BINDING_ABSENT/);

const existingOutput = join(temporaryDirectory, "existing.json");
await writeFile(existingOutput, "{}\n");
const existingRun = spawnSync(process.execPath, [...writerArgs.slice(0, -1), existingOutput], { encoding: "utf8" });
assert.notEqual(existingRun.status, 0, "existing output must be rejected");
const missingParentRun = spawnSync(process.execPath, [...writerArgs.slice(0, -1), join(temporaryDirectory, "missing-parent", "proof.json")], { encoding: "utf8" });
assert.notEqual(missingParentRun.status, 0, "missing output parent must be rejected");
const relativeRun = spawnSync(process.execPath, [...writerArgs.slice(0, -1), "relative-proof.json"], { encoding: "utf8" });
assert.notEqual(relativeRun.status, 0, "relative output must be rejected");
const insideRun = spawnSync(process.execPath, [...writerArgs.slice(0, -1), join(process.cwd(), "inside-proof.json")], { encoding: "utf8" });
assert.notEqual(insideRun.status, 0, "repository output must be rejected");

async function collectClientSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return collectClientSources(file);
    return /\.(?:tsx|jsx)$/.test(entry.name) ? [await readFile(file, "utf8")] : [];
  }));
  return nested.flat();
}
const clientSources = (await collectClientSources("src/components")).join("\n");
assert.doesNotMatch(clientSources, /legal-consent-repository\.server|moderation-notifications\.server|SUPABASE_SERVICE_ROLE_KEY/);
console.log("operational-guardrails service-role binding proof: PASS offline-cases=19");
