import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ACTIVE_CONSUMERS,
  LEGACY_SERVICE_ROLE_FACTORY,
  PROVISIONAL_EXACT_ALLOWLIST,
  SERVICE_ROLE_BINDING,
  assertExactConsumerAllowlist,
} from "../tests/fixtures/operational-guardrails-service-role-consumer-scope.mjs";

const root = process.cwd();

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(relativePath) : [relativePath];
  }));
  return nested.flat();
}

async function sourceText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function walkIfPresent(directory) {
  try {
    return await walk(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

const sourceFiles = (await Promise.all([walk("src"), walk("functions")])).flat().filter((relativePath) => /\.(?:ts|tsx|astro)$/.test(relativePath));
const sourceByPath = Object.fromEntries(await Promise.all(sourceFiles.map(async (relativePath) => [relativePath, await sourceText(relativePath)])));
const directConsumers = sourceFiles.filter((relativePath) => sourceByPath[relativePath].includes(SERVICE_ROLE_BINDING)).sort();
const expectedDirectConsumers = [...ACTIVE_CONSUMERS.map((consumer) => consumer.path), LEGACY_SERVICE_ROLE_FACTORY].sort();

assert.deepEqual(directConsumers, expectedDirectConsumers, "complete source inventory must change on any new, moved, or removed direct service-role consumer");
assertExactConsumerAllowlist(PROVISIONAL_EXACT_ALLOWLIST);
assert.throws(() => assertExactConsumerAllowlist([...PROVISIONAL_EXACT_ALLOWLIST, "src/lib/server/new-consumer.server.ts"]), /exact reviewed/);
assert.throws(() => assertExactConsumerAllowlist(["src/lib/server/**", ...PROVISIONAL_EXACT_ALLOWLIST.slice(1)]), /exact reviewed/);
assert.throws(() => assertExactConsumerAllowlist(["src/lib/server/", ...PROVISIONAL_EXACT_ALLOWLIST.slice(1)]), /exact reviewed/);
assert.throws(() => assertExactConsumerAllowlist(PROVISIONAL_EXACT_ALLOWLIST.map((entry) => entry.replace("consume-forum-rate-limit", "moved-rate-limit"))), /exact reviewed/);

for (const consumer of ACTIVE_CONSUMERS) {
  const source = sourceByPath[consumer.path];
  assert.ok(source, `${consumer.path} must remain an active source file`);
  assert.match(source, new RegExp(SERVICE_ROLE_BINDING));
  assert.doesNotMatch(source, /(?:console\.|logger\.|JSON\.stringify\([^)]*SUPABASE_SERVICE_ROLE_KEY|throw new Error\([^)]*SUPABASE_SERVICE_ROLE_KEY)/);
  for (const importerPath of consumer.importerPaths) {
    const importer = sourceByPath[importerPath];
    assert.ok(importer, `${consumer.path} importer ${importerPath} must remain in the active source graph`);
    const importStem = path.basename(consumer.path).replace(/\.ts$/, "").replace(/[.]/g, "\\.");
    assert.match(importer, new RegExp(importStem));
  }
}

const browserSources = (await walk("src/components")).filter((relativePath) => /\.(?:tsx|jsx)$/.test(relativePath));
for (const relativePath of browserSources) {
  const source = sourceByPath[relativePath] ?? await sourceText(relativePath);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|PUBLIC_SUPABASE_SERVICE_ROLE_KEY|legal-consent-repository\.server|moderation-notifications\.server|consume-forum-rate-limit\.server/);
}
const publicEnvSources = await Promise.all([sourceText("src/lib/supabase-browser.ts"), sourceText("src/lib/supabase-server.ts"), sourceText("wrangler.toml")]);
assert.doesNotMatch(publicEnvSources.join("\n"), /PUBLIC_[A-Z0-9_]*SERVICE_ROLE/i, "no public service-role binding is allowed");
const generatedClientAssets = await walkIfPresent("dist/_astro");
for (const relativePath of generatedClientAssets.filter((candidate) => /\.(?:js|mjs|css|html)$/.test(candidate))) {
  assert.doesNotMatch(await sourceText(relativePath), /SUPABASE_SERVICE_ROLE_KEY|service_role/i, `browser asset exposes service-role material: ${relativePath}`);
}
const renderedHtml = (await walkIfPresent("dist")).filter((relativePath) => relativePath.endsWith(".html"));
for (const relativePath of renderedHtml) {
  assert.doesNotMatch(await sourceText(relativePath), /SUPABASE_SERVICE_ROLE_KEY|service_role/i, `rendered HTML exposes service-role material: ${relativePath}`);
}

const legalSource = sourceByPath[ACTIVE_CONSUMERS[0].path];
const moderationSource = sourceByPath[ACTIVE_CONSUMERS[1].path];
const rateLimitSource = sourceByPath[ACTIVE_CONSUMERS[2].path];
const legacySource = sourceByPath[LEGACY_SERVICE_ROLE_FACTORY];
assert.match(legalSource, /export function createLegalConsentServiceClient\([^)]*\): SupabaseClient/);
assert.match(legalSource, /return createClient\(requireEnv\(env, "SUPABASE_URL"\), requireEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)/);
assert.doesNotMatch(moderationSource, /export function createModerationNotificationServiceClient/);
assert.doesNotMatch(rateLimitSource, /export function createRateLimitRpcClient/);
assert.match(moderationSource, /type NotificationRpcClient = Pick<SupabaseClient, "rpc">/);
assert.match(rateLimitSource, /type RateLimitRpcClient = Pick<SupabaseClient, "rpc">/);
assert.match(rateLimitSource, /client\.rpc\("consume_forum_rate_limit"/);
assert.doesNotMatch(rateLimitSource, /client\.(?:from|storage|functions)\(/);
assert.match(legacySource, /export function createServiceClient\([^)]*\): SupabaseClient/);

const findings = [
  "src/lib/server/legal-consent-repository.server.ts#createLegalConsentServiceClient",
  "functions/_lib/supabase.ts#createServiceClient",
];
console.log(JSON.stringify({
  status: "PASS",
  classification: "R6_GENERIC_PRIVILEGED_CLIENT_EXPOSURE_FOUND",
  activeDirectConsumers: ACTIVE_CONSUMERS.map((consumer) => consumer.path),
  legacyDirectConsumer: LEGACY_SERVICE_ROLE_FACTORY,
  findings,
  browserExposure: false,
  generatedClientAssetFiles: generatedClientAssets.length,
  renderedHtmlFiles: renderedHtml.length,
  allowlistPolicy: "provisional-exact-only-not-approved-until-raw-factories-are-removed",
}));
