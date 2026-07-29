import { open, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createProductionMinimalCanaryReadAdapter } from "./production-minimal-canary-http-adapter.mjs";
import { createCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";
import { getMinimalCanaryMutationPlan } from "./r6-final-canary-execution-contract.mjs";

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : String(process.argv[index + 1] ?? "").trim() || null; };
const requireEnv = (name) => { const value = String(process.env[name] ?? "").trim(); if (!value) throw new Error(`QA_CANARY_ENV_REQUIRED:${name}`); return value; };
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

async function writeNew(file, value) {
  const output = path.resolve(file);
  if (path.basename(output) !== "canonical-canary-target-binding.json") fail("QA_CANARY_TARGET_BINDING_OUTPUT_INVALID");
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, output); } catch (error) { if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") fail("QA_CANARY_TARGET_BINDING_OUTPUT_EXISTS"); throw error; }
  return output;
}

const requestedSlug = arg("--requested-slug");
const output = arg("--output");
if (!requestedSlug || !output) fail("QA_CANARY_TARGET_BINDING_ARGUMENTS_INVALID");
const plan = getMinimalCanaryMutationPlan();
const adapter = createProductionMinimalCanaryReadAdapter({
  baseUrl: requireEnv("QA_BASE_URL"),
  supabaseUrl: requireEnv("QA_SUPABASE_URL"),
  anonKey: requireEnv("QA_CANARY_SUPABASE_ANON_KEY"),
  accessToken: requireEnv("QA_CANARY_ACCESS_TOKEN"),
  requestTimeoutMs: Number.parseInt(requireEnv("QA_CANARY_REQUEST_TIMEOUT_MS"), 10),
});
const actor = await adapter.authenticate();
if (!actor?.id) fail("QA_CANARY_AUTHENTICATION_FAILED");
const circle = await adapter.resolveCircle({ slug: requestedSlug });
if (!circle?.id || circle.slug !== requestedSlug) fail("QA_CANARY_CIRCLE_RESOLUTION_INCOMPLETE");
const binding = createCanonicalCanaryTargetBinding({
  resolvedAtUtc: new Date().toISOString(),
  canonicalCircleId: circle.id,
  canonicalCircleSlug: circle.slug,
  baseMutationPlanSchema: plan.schemaVersion,
  baseMutationPlanHash: plan.planSha256,
  executionCommit: requireEnv("QA_EXPECTED_RUNNER_COMMIT"),
  toolingCommit: requireEnv("QA_EXPECTED_TOOLING_COMMIT"),
});
await writeNew(output, binding);
process.stdout.write("QA_CANARY_TARGET_BINDING_READY\n");
